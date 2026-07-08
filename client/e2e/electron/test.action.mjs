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

import os from 'os';
import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

import {prepareElectronApp} from './prepare_app.mjs';

/**
 * @description Builds the Electron app for the current platform and runs the
 * desktop E2E suite (Playwright _electron) against it. Extra parameters are
 * forwarded to `playwright test`. Linux and Windows only: the Electron
 * client does not run on macOS.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  if (os.platform() !== 'linux' && os.platform() !== 'win32') {
    throw new Error(
      'The Electron E2E suite only runs on Linux and Windows (the Electron ' +
        'client does not support macOS). It runs in CI on ubuntu and ' +
        'windows runners.'
    );
  }

  await prepareElectronApp();

  // Invoke the Playwright CLI through node rather than `npx`: spawning the
  // `npx` .cmd shim without a shell fails on Windows.
  await spawnStream(
    process.execPath,
    path.join(getRootDir(), 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config',
    path.join(getRootDir(), 'client', 'e2e', 'electron.playwright.config.ts'),
    ...parameters
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
