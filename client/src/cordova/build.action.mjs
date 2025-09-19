// Copyright 2022 The Outline Authors
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

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'url';

import {downloadHttpsFile} from '@outline/infrastructure/build/download_file.mjs';
import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';
import cordovaLib from 'cordova-lib';
import * as dotenv from 'dotenv';

const {cordova} = cordovaLib;

import {getBuildParameters} from '../../build/get_build_parameters.mjs';

const CORDOVA_PLATFORMS = ['android', 'ios', 'macos'];

/**
 * @description Builds the parameterized cordova binary (ios, macos, android).
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {platform, buildMode, verbose} = getBuildParameters(parameters);

  if (!CORDOVA_PLATFORMS.includes(platform)) {
    throw new TypeError(
      `The platform "${platform}" is not a valid Cordova platform. It must be one of: ${CORDOVA_PLATFORMS.join(
        ', '
      )}.`
    );
  }

  await runAction('client/src/cordova/setup', ...parameters);

  if (verbose) {
    cordova.on('verbose', message =>
      console.debug(`[cordova:verbose] ${message}`)
    );
  }

  // this is so cordova doesn't complain about not being in a cordova project
  process.env.PWD = path.resolve(getRootDir(), 'client');

  if (platform === 'android') {
    await spawnStream('go', 'tool', 'task', 'client:android:configure');
    dotenv.config({
      path: path.resolve(getRootDir(), 'output', 'client', 'android', '.env'),
    });
  }

  switch (platform + buildMode) {
    case 'android' + 'debug':
      return androidDebug(verbose);
    case 'android' + 'release':
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

      return androidRelease(
        process.env.ANDROID_KEY_STORE_PASSWORD,
        process.env.ANDROID_KEY_STORE_CONTENTS,
        process.env.JAVA_HOME,
        verbose
      );
    case 'ios' + 'debug':
    case 'macos' + 'debug':
      return appleDebug(platform);
    case 'ios' + 'release':
    case 'macos' + 'release':
      return appleRelease(platform);
  }
}

function getXcodeBuildArgs(platform) {
  let destination, workspaceFilename;
  switch (platform) {
    case 'macos':
      destination = 'generic/platform=macOS,variant=Mac Catalyst';
      workspaceFilename = 'client.xcworkspace';
      break;
    case 'ios':
    default:
      destination = 'generic/platform=iOS';
      workspaceFilename = 'client.xcworkspace';
      break;
  }
  return [
    '-workspace',
    path.join(
      getRootDir(),
      'client',
      'src',
      'cordova',
      'apple',
      workspaceFilename
    ),
    '-scheme',
    'Outline',
    '-destination',
    destination,
  ];
}

async function appleDebug(platform) {
  console.warn(
    `WARNING: building "${platform}" in [DEBUG] mode. Do not publish this build!!`
  );

  return spawnStream(
    'xcodebuild',
    'clean',
    ...getXcodeBuildArgs(platform),
    'build',
    '-configuration',
    'Debug',
    'CODE_SIGN_IDENTITY=""',
    'CODE_SIGNING_ALLOWED="NO"'
  );
}

async function appleRelease(platform) {
  return spawnStream(
    'xcodebuild',
    'clean',
    ...getXcodeBuildArgs(platform),
    'archive',
    '-configuration',
    'Release'
  );
}

async function androidDebug(verbose) {
  console.warn(
    'WARNING: building "android" in [DEBUG] mode. Do not publish this build!!'
  );

  // Alternatively:
  // npx cordova build android -- --gradleArg=--include-build=../../src/cordova/android/OutlineAndroidLib
  return cordova.compile({
    verbose,
    platforms: ['android'],
    options: {
      argv: [
        // Path is relative to $WORKSPACE/client/platforms/android/.
        // See https://docs.gradle.org/current/userguide/composite_builds.html#command_line_composite
        // TODO(fortuna): Can we embed this in the gradle settings instead?
        '--gradleArg=--include-build=../../src/cordova/android/OutlineAndroidLib',
        verbose ? '--gradleArg=--info' : '--gradleArg=--quiet',
      ],
    },
  });
}

const JAVA_BUNDLETOOL_VERSION = '1.8.2';
const JAVA_BUNDLETOOL_RESOURCE_URL = `https://github.com/google/bundletool/releases/download/1.8.2/bundletool-all-${JAVA_BUNDLETOOL_VERSION}.jar`;

async function androidRelease(ksPassword, ksContents, javaPath, verbose) {
  const androidBuildPath = path.resolve(
    getRootDir(),
    'client',
    'platforms',
    'android'
  );
  const keystorePath = path.resolve(androidBuildPath, 'keystore.p12');

  await fs.writeFile(keystorePath, Buffer.from(ksContents, 'base64'));

  await cordova.compile({
    verbose,
    platforms: ['android'],
    options: {
      release: true,
      argv: [
        // Path is relative to /platforms/android/.
        // See https://docs.gradle.org/current/userguide/composite_builds.html#command_line_composite
        '--gradleArg=--include-build=../../src/cordova/android/OutlineAndroidLib',
        verbose ? '--gradleArg=--info' : '--gradleArg=--quiet',
        `--keystore=${keystorePath}`,
        '--alias=privatekey',
        `--storePassword=${ksPassword}`,
        `--password=${ksPassword}`,
        '--',
        '--gradleArg=-PcdvBuildMultipleApks=true',
      ],
    },
  });

  const bundletoolPath = path.resolve(androidBuildPath, 'bundletool.jar');
  await downloadHttpsFile(JAVA_BUNDLETOOL_RESOURCE_URL, bundletoolPath);

  const outputPath = path.resolve(androidBuildPath, 'Outline.apks');
  await spawnStream(
    path.resolve(javaPath, 'bin', 'java'),
    '-jar',
    bundletoolPath,
    'build-apks',
    `--bundle=${path.resolve(
      androidBuildPath,
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

  return fs.rename(outputPath, path.resolve(androidBuildPath, 'Outline.zip'));
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
