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

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';

import {stageRuntimeAssets} from '../../electron/stage_runtime_assets.mjs';

/**
 * Builds the Electron app for the current Linux architecture and stages every
 * runtime asset the unpackaged launch needs, exactly as a packaged build
 * would lay them out. Shared by the Electron E2E test actions.
 *
 * @returns {Promise<string>} Absolute path to the launchable app directory.
 */
export async function prepareElectronApp() {
  // Node's os.arch() values ('x64', 'arm64') match the --arch values the
  // build actions accept; the Go toolchain names them differently.
  const arch = os.arch();
  const goArch = {x64: 'amd64', arm64: 'arm64', ia32: '386'}[arch] ?? arch;

  // Compiles libbackend.so + tun2socks for the current linux arch.
  await runAction('client/go/build', 'linux', `--arch=${arch}`);
  // Builds the web UI and webpacks the Electron main process + preload.
  await runAction('client/electron/build_main', 'linux', `--arch=${arch}`);

  const appPath = path.join(getRootDir(), 'output', 'client', 'electron');

  // Mirror the tray icons, web app, and platform icons into the launched app
  // path so app.getAppPath()-relative lookups resolve, exactly as the `start`
  // action does (this build skips electron-builder packaging).
  await stageRuntimeAssets(appPath);

  // Stage the Go backend (libbackend.so + tun2socks) at the path
  // app_paths.ts#pathToBackendLibrary resolves it: <appPath>/output/client/
  // linux-<goArch>. In a packaged build electron-builder bundles this dir; the
  // unpackaged E2E launch has to mirror it so the real backend loads.
  const backendDir = path.join('output', 'client', `linux-${goArch}`);
  await fs.cp(
    path.join(getRootDir(), backendDir),
    path.join(appPath, backendDir),
    {recursive: true}
  );

  return appPath;
}
