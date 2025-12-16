// Copyright 2025 The Outline Authors
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

import { downloadHttpsFile } from '@outline/infrastructure/build/download_file.mjs';
import { getRootDir } from '@outline/infrastructure/build/get_root_dir.mjs';
import { runAction } from '@outline/infrastructure/build/run_action.mjs';
import { spawnStream } from '@outline/infrastructure/build/spawn_stream.mjs';

import { getBuildParameters } from '@outline/client/build/get_build_parameters.mjs';
import { makeReplacements } from '@outline/client/build/make_replacements.mjs';

const CAPACITOR_PLATFORMS = ['capacitor-ios', 'capacitor-android'];

const JAVA_BUNDLETOOL_VERSION = '1.8.2';
const JAVA_BUNDLETOOL_RESOURCE_URL = `https://github.com/google/bundletool/releases/download/1.8.2/bundletool-all-${JAVA_BUNDLETOOL_VERSION}.jar`;

/**
 * @description Builds the parameterized Capacitor binary (ios, android).
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const { platform, buildMode, verbose, versionName, buildNumber } =
    getBuildParameters(parameters);

  if (!CAPACITOR_PLATFORMS.includes(platform)) {
    throw new TypeError(
      `The platform "${platform}" is not a valid Capacitor platform. It must be one of: ${CAPACITOR_PLATFORMS.join(
        ', '
      )}.`
    );
  }

  const root = getRootDir();
  const capRoot = path.resolve(root, 'client', 'capacitor');

  // Map Capacitor platforms to their native equivalents for Go build and Capacitor CLI
  const platformMap = {
    'capacitor-ios': 'ios',
    'capacitor-android': 'android',
  };

  const nativePlatform = platformMap[platform] || platform;
  const nativeBuildArgs = nativePlatform
    ? [nativePlatform, ...parameters.slice(1)]
    : parameters.slice(1);

  await runAction('client/go/build', ...nativeBuildArgs);
  await runAction('client/web/build', ...parameters);

  const prevCwd = process.cwd();

  try {
    process.chdir(capRoot);

    await spawnStream('npx', 'capacitor-assets', 'generate');

    if (nativePlatform === 'ios') {
      await spawnStream('node', 'build/cap-sync-ios.mjs');
    } else if (nativePlatform === 'android') {
      await spawnStream('node', 'build/cap-sync-android.mjs');
    }

    let buildResult;
    switch (platform + buildMode) {
      case 'capacitor-android' + 'debug':
        buildResult = await androidDebug(verbose);
        break;
      case 'capacitor-android' + 'release':
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

        await setAndroidVersion(versionName, buildNumber);
        buildResult = await androidRelease(
          process.env.ANDROID_KEY_STORE_PASSWORD,
          process.env.ANDROID_KEY_STORE_CONTENTS,
          process.env.JAVA_HOME,
          verbose
        );
        break;
      case 'capacitor-ios' + 'debug':
        buildResult = await iosDebug();
        break;
      case 'capacitor-ios' + 'release':
        await setIOSVersion(versionName, buildNumber);
        buildResult = await iosRelease();
        break;
    }

    // Open the project in the native IDE via Capacitor CLI after a successful build
    if (nativePlatform === 'ios' || nativePlatform === 'android') {
      await spawnStream('npx', 'cap', 'open', nativePlatform);
    }

    return buildResult;
  } finally {
    process.chdir(prevCwd);
  }
}

async function androidDebug(verbose) {
  console.warn(
    'WARNING: building "android" in [DEBUG] mode. Do not publish this build!!'
  );

  const root = getRootDir();
  const androidRoot = path.resolve(root, 'client', 'capacitor', 'android');
  const gradlewPath = path.resolve(androidRoot, 'gradlew');

  await spawnStream(
    gradlewPath,
    'assembleDebug',
    verbose ? '--info' : '--quiet',
    {
      cwd: androidRoot,
      shell: true,
    }
  );
}

async function androidRelease(ksPassword, ksContents, javaPath, verbose) {
  const root = getRootDir();
  const androidRoot = path.resolve(root, 'client', 'capacitor', 'android');
  const keystorePath = path.resolve(androidRoot, 'keystore.p12');
  const gradlewPath = path.resolve(androidRoot, 'gradlew');

  await fs.writeFile(keystorePath, Buffer.from(ksContents, 'base64'));

  await spawnStream(
    gradlewPath,
    'bundleRelease',
    `-Pandroid.injected.signing.store.file=${keystorePath}`,
    `-Pandroid.injected.signing.store.password=${ksPassword}`,
    `-Pandroid.injected.signing.key.alias=privatekey`,
    `-Pandroid.injected.signing.key.password=${ksPassword}`,
    verbose ? '--info' : '--quiet',
    {
      cwd: androidRoot,
      shell: true,
    }
  );

  const bundletoolPath = path.resolve(androidRoot, 'bundletool.jar');
  await downloadHttpsFile(JAVA_BUNDLETOOL_RESOURCE_URL, bundletoolPath);

  const outputPath = path.resolve(androidRoot, 'Outline.apks');
  await spawnStream(
    path.resolve(javaPath, 'bin', 'java'),
    '-jar',
    bundletoolPath,
    'build-apks',
    `--bundle=${path.resolve(
      androidRoot,
      'app',
      'build',
      'outputs',
      'bundle',
      'release',
      'app-release.aab'
    )}`,
    `--output=${outputPath}`,
    '--mode=universal',
    `--ks=${keystorePath}`,
    `--ks-pass=pass:${ksPassword}`,
    '--ks-key-alias=privatekey',
    `--key-pass=pass:${ksPassword}`
  );

  return fs.rename(outputPath, path.resolve(androidRoot, 'Outline.zip'));
}

async function setAndroidVersion(versionName, buildNumber) {
  const root = getRootDir();
  const androidRoot = path.resolve(root, 'client', 'capacitor', 'android');

  const buildGradlePath = path.resolve(androidRoot, 'app', 'build.gradle');

  await makeReplacements([
    {
      files: buildGradlePath,
      from: /versionCode\s+\d+/g,
      to: `versionCode ${buildNumber}`,
    },
    {
      files: buildGradlePath,
      from: /versionName\s+"[^"]*"/g,
      to: `versionName "${versionName}"`,
    },
  ]);

  console.log(
    `Updated Android version: versionCode=${buildNumber}, versionName="${versionName}"`
  );
}

async function iosDebug() {
  if (os.platform() !== 'darwin') {
    throw new Error(
      'Building an iOS binary requires xcodebuild and can only be done on macOS'
    );
  }

  console.warn(
    'WARNING: building "ios" in [DEBUG] mode. Do not publish this build!!'
  );

  const root = getRootDir();
  const iosRoot = path.resolve(root, 'client', 'capacitor', 'ios', 'App');

  return spawnStream(
    'xcodebuild',
    '-project',
    path.resolve(iosRoot, 'App.xcodeproj'),
    '-scheme',
    'Outline',
    '-destination',
    'generic/platform=iOS',
    'clean',
    'build',
    '-configuration',
    'Debug',
    'CODE_SIGN_IDENTITY=""',
    'CODE_SIGNING_ALLOWED="NO"'
  );
}

async function iosRelease() {
  if (os.platform() !== 'darwin') {
    throw new Error(
      'Building an iOS binary requires xcodebuild and can only be done on macOS'
    );
  }

  const root = getRootDir();
  const iosRoot = path.resolve(root, 'client', 'capacitor', 'ios', 'App');

  await spawnStream(
    'xcodebuild',
    '-project',
    path.resolve(iosRoot, 'App.xcodeproj'),
    '-scheme',
    'Outline',
    '-destination',
    'generic/platform=iOS',
    'clean',
    'archive',
    '-configuration',
    'Release'
  );

  const archivesPath = path.resolve(
    os.homedir(),
    'Library',
    'Developer',
    'Xcode',
    'Archives'
  );
  console.log(`\nArchive created!`);
  console.log(`Archive location: ${archivesPath}`);
  console.log('To export for TestFlight:');
  console.log('   1. Open Xcode > Window > Organizer (⌘⇧⌥O)');
  console.log('   2. Select your archive');
  console.log('   3. Click "Distribute App" > "App Store Connect"');
}

async function setIOSVersion(versionName, buildNumber) {
  const root = getRootDir();
  const appInfoPlistPath = path.resolve(
    root,
    'client',
    'capacitor',
    'ios',
    'App',
    'App',
    'Info.plist'
  );
  const vpnExtensionInfoPlistPath = path.resolve(
    root,
    'client',
    'capacitor',
    'ios',
    'App',
    'VpnExtension',
    'Info.plist'
  );
  const projectPbxprojPath = path.resolve(
    root,
    'client',
    'capacitor',
    'ios',
    'App',
    'App.xcodeproj',
    'project.pbxproj'
  );

  await makeReplacements([
    {
      files: appInfoPlistPath,
      from: /<key>CFBundleShortVersionString<\/key>\s*<string>.*<\/string>/g,
      to: `<key>CFBundleShortVersionString</key>\n\t<string>${versionName}</string>`,
    },
    {
      files: appInfoPlistPath,
      from: /<key>CFBundleVersion<\/key>\s*<string>.*<\/string>/g,
      to: `<key>CFBundleVersion</key>\n\t<string>${buildNumber}</string>`,
    },
  ]);

  const vpnExtensionPlist = await fs.readFile(vpnExtensionInfoPlistPath, 'utf8');
  let updatedVpnPlist = vpnExtensionPlist;

  if (vpnExtensionPlist.includes('<key>CFBundleShortVersionString</key>')) {
    updatedVpnPlist = updatedVpnPlist.replace(
      /<key>CFBundleShortVersionString<\/key>\s*<string>.*<\/string>/g,
      `<key>CFBundleShortVersionString</key>\n\t<string>${versionName}</string>`
    );
  } else {
    updatedVpnPlist = updatedVpnPlist.replace(
      /(<dict>)/,
      `$1\n\t<key>CFBundleShortVersionString</key>\n\t<string>${versionName}</string>`
    );
  }

  if (vpnExtensionPlist.includes('<key>CFBundleVersion</key>')) {
    updatedVpnPlist = updatedVpnPlist.replace(
      /<key>CFBundleVersion<\/key>\s*<string>.*<\/string>/g,
      `<key>CFBundleVersion</key>\n\t<string>${buildNumber}</string>`
    );
  } else {
    if (updatedVpnPlist.includes('<key>CFBundleShortVersionString</key>')) {
      updatedVpnPlist = updatedVpnPlist.replace(
        /(<key>CFBundleShortVersionString<\/key>\s*<string>.*<\/string>)/,
        `$1\n\t<key>CFBundleVersion</key>\n\t<string>${buildNumber}</string>`
      );
    } else {
      updatedVpnPlist = updatedVpnPlist.replace(
        /(<dict>)/,
        `$1\n\t<key>CFBundleVersion</key>\n\t<string>${buildNumber}</string>`
      );
    }
  }

  await fs.writeFile(vpnExtensionInfoPlistPath, updatedVpnPlist, 'utf8');
  await makeReplacements([
    {
      files: projectPbxprojPath,
      from: /CURRENT_PROJECT_VERSION = \d+;/g,
      to: `CURRENT_PROJECT_VERSION = ${buildNumber};`,
    },
    {
      files: projectPbxprojPath,
      from: /MARKETING_VERSION = [\d.]+;/g,
      to: `MARKETING_VERSION = ${versionName};`,
    },
  ]);

  console.log(
    `Updated iOS versions: App and VpnExtension - versionName="${versionName}", buildNumber="${buildNumber}"`
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
