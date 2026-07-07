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
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

import {stageRuntimeAssets} from '../../electron/stage_runtime_assets.mjs';

/**
 * @description Builds the Electron app for Linux and runs the desktop E2E
 * suite (Playwright _electron) against it. Extra parameters are forwarded to
 * `playwright test`. Linux-only: the Electron client does not run on macOS.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  if (os.platform() !== 'linux') {
    throw new Error(
      'The Electron E2E suite only runs on Linux (the Electron client ' +
        'does not support macOS). It runs in CI on ubuntu runners.'
    );
  }

  // Node's os.arch() values ('x64', 'arm64') match the --arch values the
  // build actions accept.
  const arch = os.arch();

  // Compiles libbackend.so + tun2socks for the current linux arch.
  await runAction('client/go/build', 'linux', `--arch=${arch}`);
  // Builds the web UI and webpacks the Electron main process + preload.
  await runAction('client/electron/build_main', 'linux', `--arch=${arch}`);

  // Mirror the tray icons, web app, and platform icons into the launched app
  // path so app.getAppPath()-relative lookups resolve, exactly as the `start`
  // action does (this build skips electron-builder packaging).
  await stageRuntimeAssets(
    path.join(getRootDir(), 'output', 'client', 'electron')
  );

  await spawnStream(
    'npx',
    'playwright',
    'test',
    '--config',
    path.join(getRootDir(), 'client', 'e2e', 'electron.playwright.config.ts'),
    ...parameters
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
