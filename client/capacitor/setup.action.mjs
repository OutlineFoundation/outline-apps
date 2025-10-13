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

import url from 'url';
import fs from 'fs/promises';
import path from 'path';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';
import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';

export async function main(..._argv) {
  const root = getRootDir();
  const clientRoot = path.resolve(root, 'client');
  const capRoot = path.resolve(root, 'client', 'capacitor');
  const www = path.join(clientRoot, 'www');

  // 1) Always build web assets
  await spawnStream('npm', 'run', 'action', 'client/web/build');
  await spawnStream('npm', 'run', 'action', 'client/go/build');

 // 2) Always copy index_cordova.html → index.html
  await fs.copyFile(
    path.join(www, 'index_cordova.html'),
    path.join(www, 'index.html')
  );

  // 3) Generate icons/splashes, then sync (run from Capacitor root, and restore cwd after)
  const prevCwd = process.cwd();
  try {
    process.chdir(capRoot);
    await spawnStream('npx', 'capacitor-assets', 'generate');
    await spawnStream('npx', 'cap', 'sync');
  } finally {
    process.chdir(prevCwd);
  }
}

// Only run if invoked directly
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
