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
import * as dotenv from 'dotenv';

import { getBuildParameters } from '@outline/client/build/get_build_parameters.mjs';
import { makeReplacements } from '@outline/client/build/make_replacements.mjs';

const CAPACITOR_PLATFORMS = ['capacitor-android'];

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
  dotenv.config({ path: path.resolve(root, '.env') });
  const capRoot = path.resolve(root, 'client', 'capacitor');

  // Map Capacitor platforms to their native equivalents for Go build and Capacitor CLI
  const platformMap = {
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

    if (nativePlatform === 'android') {
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

  const prevCwd = process.cwd();
  try {
    process.chdir(androidRoot);

    await spawnStream(
      './gradlew',
      'assembleDebug',
      verbose ? '--info' : '--quiet'
    );
  } finally {
    process.chdir(prevCwd);
  }
}

async function androidRelease(ksPassword, ksContents, javaPath, verbose) {
  const root = getRootDir();
  const androidRoot = path.resolve(root, 'client', 'capacitor', 'android');
  const keystorePath = path.resolve(androidRoot, 'keystore.p12');

  await fs.writeFile(keystorePath, Buffer.from(ksContents, 'base64'));

  const prevCwd = process.cwd();
  try {
    process.chdir(androidRoot);

    await spawnStream(
      './gradlew',
      'bundleRelease',
      `-Pandroid.injected.signing.store.file=${keystorePath}`,
      `-Pandroid.injected.signing.store.password=${ksPassword}`,
      `-Pandroid.injected.signing.key.alias=privatekey`,
      `-Pandroid.injected.signing.key.password=${ksPassword}`,
      verbose ? '--info' : '--quiet'
    );
  } finally {
    process.chdir(prevCwd);
  }

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

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
