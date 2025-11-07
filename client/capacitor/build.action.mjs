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

import { getRootDir } from '@outline/infrastructure/build/get_root_dir.mjs';
import { runAction } from '@outline/infrastructure/build/run_action.mjs';
import { spawnStream } from '@outline/infrastructure/build/spawn_stream.mjs';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';

export async function main(...argv) {
  const root = getRootDir();
  const capRoot = path.resolve(root, 'client', 'capacitor');
  const www = path.resolve(root, 'client', 'www');

  await runAction('client/go/build', ...argv);
  await runAction('client/web/build');

  await fs.copyFile(
    path.join(www, 'index_cordova.html'),
    path.join(www, 'index.html')
  );

  const prevCwd = process.cwd();

  try {
    process.chdir(capRoot);                // ensure Capacitor resolves config/project
    await spawnStream('npx', 'capacitor-assets', 'generate');

    const platform = argv[0];
    if (platform === 'capacitor-ios') {
      await spawnStream('node', 'scripts/cap-sync-ios.mjs');
    } else {
      await spawnStream('npx', 'cap', 'sync');
    }

    await spawnStream('npx', 'cap', 'open', ...argv);
  } finally {
    process.chdir(prevCwd);               // restore original working dir
  }
}

// Only run if invoked directly
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
