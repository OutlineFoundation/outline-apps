// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

import {buildWebBundle} from './web_bundle.mjs';
import {buildUniversalApkSet} from '../build/android_universal_apk.mjs';
import {getBuildParameters} from '../build/get_build_parameters.mjs';

const capacitorDir = path.dirname(url.fileURLToPath(import.meta.url));

const CAPACITOR_PLATFORMS = ['android', 'ios', 'macos'];

// The macOS client is the iOS app built for Mac Catalyst, so it shares the
// Capacitor "ios" platform (native project, plugins, `cap sync`).
const APPLE_PLATFORMS = ['ios', 'macos'];

/**
 * @description Fully builds the Capacitor client: the web bundle, the
 * tun2socks native library, and the native app binary. "macos" builds the
 * iOS app for Mac Catalyst.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const buildParameters = getBuildParameters(parameters);
  const {platform, buildMode, verbose, versionName, buildNumber} =
    buildParameters;

  if (!CAPACITOR_PLATFORMS.includes(platform)) {
    throw new TypeError(
      `Capacitor build.action.mjs supports platforms ${CAPACITOR_PLATFORMS.join(', ')}, got "${platform}".`
    );
  }

  // Check the release signing inputs before the (slow) web and Go builds.
  if (APPLE_PLATFORMS.includes(platform) && buildMode === 'release') {
    // The app target has no development team of its own (see
    // apple/App/App.xcodeproj), so a signed build needs one from the caller.
    if (!process.env.DEVELOPMENT_TEAM) {
      throw new ReferenceError(
        `DEVELOPMENT_TEAM must be defined in the environment to build a ${platform} Release!`
      );
    }
  }

  if (platform === 'android' && buildMode === 'release') {
    if (!process.env.JAVA_HOME) {
      throw new ReferenceError(
        'JAVA_HOME must be defined in the environment to build an Android Release!'
      );
    }

    if (
      !(
        process.env.ANDROID_KEY_STORE_PASSWORD &&
        process.env.ANDROID_KEY_STORE_CONTENTS
      )
    ) {
      throw new ReferenceError(
        "Both 'ANDROID_KEY_STORE_PASSWORD' and 'ANDROID_KEY_STORE_CONTENTS' must be defined in the environment to build an Android Release!"
      );
    }
  }

  // Build the web bundle (client/capacitor/www/) that `cap sync` copies into
  // the native project.
  await buildWebBundle(buildParameters);

  // `cap sync` first runs the capacitor:sync:before hook (see package.json in
  // this directory), which builds the tun2socks native library for the
  // platform: the gomobile AAR (plus client:android:configure) on Android, and
  // the Tun2socks.xcframework that apple/App/App.xcodeproj links from
  // output/client/apple/ on iOS. It then copies the web assets into the native
  // project and refreshes the Capacitor plugins. The Capacitor CLI locates the
  // project from the working directory.
  process.chdir(capacitorDir);
  await spawnStream(
    'npx',
    'cap',
    'sync',
    platform === 'macos' ? 'ios' : platform
  );

  switch (platform + buildMode) {
    case 'android' + 'debug':
      return androidDebug(verbose);
    case 'android' + 'release':
      return androidRelease(
        process.env.ANDROID_KEY_STORE_PASSWORD,
        process.env.ANDROID_KEY_STORE_CONTENTS,
        process.env.JAVA_HOME,
        versionName,
        buildNumber,
        verbose
      );
    case 'ios' + 'debug':
    case 'macos' + 'debug':
      return appleDebug(platform, verbose);
    case 'ios' + 'release':
    case 'macos' + 'release':
      return appleRelease(
        platform,
        process.env.DEVELOPMENT_TEAM,
        versionName,
        buildNumber,
        verbose
      );
  }
}

const androidDir = path.resolve(capacitorDir, 'android');

async function androidDebug(verbose) {
  // `cap build` only produces signed release builds, so invoke Gradle
  // directly for the debug APK — the same target `cap run` uses.
  await spawnStream(
    path.join(androidDir, 'gradlew'),
    '-p',
    androidDir,
    verbose ? '--info' : '--quiet',
    'assembleDebug'
  );
}

/**
 * Builds the signed release AAB (for the Play Store) and, from it, the signed
 * universal APK (for direct download). Both land in
 * android/app/build/outputs/bundle/release/.
 */
async function androidRelease(
  ksPassword,
  ksContents,
  javaPath,
  versionName,
  buildNumber,
  verbose
) {
  // Decode the keystore into a private (0700) temp directory rather than the
  // source tree, and remove it as soon as the build is done.
  const keystoreDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'outline-android-keystore-')
  );
  const keystorePath = path.join(keystoreDir, 'keystore.p12');

  try {
    await fs.writeFile(keystorePath, Buffer.from(ksContents, 'base64'), {
      mode: 0o600,
    });

    // app/build.gradle versions and signs the release from these properties.
    // It reads the keystore password from ANDROID_KEY_STORE_PASSWORD in the
    // environment, because spawnStream echoes the command line.
    await spawnStream(
      path.join(androidDir, 'gradlew'),
      '-p',
      androidDir,
      verbose ? '--info' : '--quiet',
      'bundleRelease',
      `-PoutlineVersionName=${versionName}`,
      `-PoutlineVersionCode=${buildNumber}`,
      `-PoutlineKeystorePath=${keystorePath}`
    );

    const bundleDir = path.resolve(
      androidDir,
      'app',
      'build',
      'outputs',
      'bundle',
      'release'
    );
    await buildUniversalApkSet({
      bundlePath: path.resolve(bundleDir, 'app-release.aab'),
      outputDir: bundleDir,
      keystorePath,
      ksPassword,
      javaPath,
    });
  } finally {
    await fs.rm(keystoreDir, {recursive: true, force: true});
  }
}

// The macOS client is the iOS app built for Mac Catalyst: same project and
// scheme, different destination. Capacitor's iOS platform is a source Swift
// package, so it compiles for Catalyst like any other package in the graph.
const XCODE_DESTINATIONS = {
  ios: 'generic/platform=iOS',
  macos: 'generic/platform=macOS,variant=Mac Catalyst',
};

function xcodeBuildArgs(platform, verbose) {
  return [
    '-project',
    path.resolve(capacitorDir, 'apple', 'App', 'App.xcodeproj'),
    '-scheme',
    'Outline',
    '-destination',
    XCODE_DESTINATIONS[platform],
    ...(verbose ? [] : ['-quiet']),
  ];
}

/**
 * Builds an unsigned debug app. `cap build` only produces signed release
 * builds, so this invokes xcodebuild directly. Signing is disabled so the build
 * needs no development team or provisioning profile, which CI does not have.
 */
async function appleDebug(platform, verbose) {
  console.warn(
    `WARNING: building "${platform}" in [DEBUG] mode. Do not publish this build!!`
  );
  await spawnStream(
    'xcodebuild',
    'clean',
    ...xcodeBuildArgs(platform, verbose),
    'build',
    '-configuration',
    'Debug',
    'CODE_SIGN_IDENTITY=',
    'CODE_SIGNING_ALLOWED=NO'
  );
}

/**
 * Archives the signed release app to output/client/<platform>/Outline.xcarchive,
 * replacing any previous archive there.
 */
async function appleRelease(
  platform,
  teamId,
  versionName,
  buildNumber,
  verbose
) {
  const archivePath = path.resolve(
    getRootDir(),
    'output',
    'client',
    platform,
    'Outline.xcarchive'
  );
  await fs.rm(archivePath, {recursive: true, force: true});

  await spawnStream(
    'xcodebuild',
    'clean',
    ...xcodeBuildArgs(platform, verbose),
    'archive',
    '-archivePath',
    archivePath,
    '-configuration',
    'Release',
    '-allowProvisioningUpdates',
    // The Info.plist of the app and of the VpnExtension take their version
    // from these build settings.
    `MARKETING_VERSION=${versionName}`,
    `CURRENT_PROJECT_VERSION=${buildNumber}`,
    `DEVELOPMENT_TEAM=${teamId}`
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
