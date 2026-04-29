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
import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';
import electron from 'electron';

import {getBuildParameters} from '../build/get_build_parameters.mjs';

// Runtime assets that the main process loads via `app.getAppPath()` and that
// `electron-builder` bundles into packaged builds (see `electron-builder.json`
// `files`). The `start` action launches Electron directly against
// `output/client/electron`, bypassing electron-builder, so we mirror these
// directories into the launched app path ourselves. Without this, code such as
// the tray icon loader throws `cannot find <name>.png tray icon image`.
const RUNTIME_ASSET_DIRS = [
  path.join('client', 'resources', 'tray'),
  path.join('client', 'www'),
  path.join('client', 'electron', 'icons'),
];

/**
 * @description Builds and starts the electron application.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {platform, buildMode} = getBuildParameters(parameters);

  await runAction('client/web/build', platform, `--buildMode=${buildMode}`);
  await runAction('client/electron/build_main', ...parameters);
  await runAction(
    'client/electron/build',
    platform,
    `--buildMode=${buildMode}`
  );

  const appPath = path.join(getRootDir(), 'output', 'client', 'electron');
  await stageRuntimeAssets(appPath);

  process.env.OUTLINE_DEBUG = buildMode === 'debug';

  await spawnStream(electron, appPath);
}

/**
 * Mirrors directories listed in {@link RUNTIME_ASSET_DIRS} from the repo root
 * into the launched Electron app path so `app.getAppPath()`-relative lookups
 * resolve the same way they would in a packaged build.
 *
 * @param {string} appPath Absolute path to the directory passed to Electron.
 */
async function stageRuntimeAssets(appPath) {
  for (const relativeDir of RUNTIME_ASSET_DIRS) {
    const source = path.join(getRootDir(), relativeDir);
    const destination = path.join(appPath, relativeDir);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.cp(source, destination, {recursive: true});
  }
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
