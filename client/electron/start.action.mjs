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

import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';
import electron from 'electron';

import {getBuildParameters} from '../build/get_build_parameters.mjs';

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

  process.env.OUTLINE_DEBUG = buildMode === 'debug';

  await spawnStream(
    electron,
    path.join(getRootDir(), 'output', 'client', 'electron')
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
