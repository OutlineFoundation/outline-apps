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

import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

/**
 * @description Runs the shared-UI E2E suite (Playwright) against the Capacitor
 * browser build. Extra parameters are forwarded to `playwright test`.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  await runAction('client/capacitor/build', 'browser');

  await spawnStream(
    'npx',
    'playwright',
    'test',
    '--config',
    path.join(getRootDir(), 'client', 'e2e', 'playwright.config.ts'),
    ...parameters
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
