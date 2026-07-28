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

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';
import minimist from 'minimist';
import rmfr from 'rmfr';

const APPLE_ROOT = path.join(getRootDir(), 'client', 'src', 'cordova', 'apple');

const SUPPORTED_PLATFORMS = new Set(['ios', 'macos']);

/**
 * @description Tests the parameterized cordova binary (ios, macos).
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {
    _: [outlinePlatform],
  } = minimist(parameters);

  if (!SUPPORTED_PLATFORMS.has(outlinePlatform)) {
    throw new Error(
      'Testing is only currently supported for platforms: ' +
        Array.from(SUPPORTED_PLATFORMS)
    );
  }

  if (os.platform() !== 'darwin') {
    throw new Error(
      'Building an Apple binary requires xcodebuild and can only be done on MacOS'
    );
  }

  const derivedDataPath = path.join(
    process.env.COVERAGE_DIR,
    'apple',
    outlinePlatform
  );

  await rmfr(derivedDataPath);
  await runAction('client/go/build', outlinePlatform);
  await spawnStream(
    'xcodebuild',
    'test',
    '-scheme',
    'VpnExtensionTest',
    '-destination',
    outlinePlatform === 'macos'
      ? `platform=macOS,variant=Mac Catalyst,arch=${os.machine()}`
      : 'platform=iOS Simulator,OS=latest,name=iPhone 16',
    '-project',
    path.join(APPLE_ROOT, 'OutlineLib', 'OutlineLib.xcodeproj'),
    '-enableCodeCoverage',
    'YES',
    '-derivedDataPath',
    derivedDataPath,
    'CODE_SIGN_IDENTITY=""',
    'CODE_SIGNING_ALLOWED="NO"'
  );

  const testCoverageDirectoryPath = path.join(derivedDataPath, 'Logs', 'Test');
  const testCoverageResultFilename = (
    await fs.readdir(testCoverageDirectoryPath)
  ).find(filename => filename.endsWith('xcresult'));

  await fs.rename(
    path.join(testCoverageDirectoryPath, testCoverageResultFilename),
    path.join(derivedDataPath, 'TestResult.xcresult')
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
