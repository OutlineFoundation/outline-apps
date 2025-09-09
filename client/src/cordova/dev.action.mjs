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

import os from 'os';
import path from 'path';
import url from 'url';

import {createReloadServer} from '@outline/infrastructure/build/create_reload_server.mjs';
import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';
import {hashElement} from 'folder-hash';
import * as fs from 'fs-extra';
import minimist from 'minimist';

import {makeReplacements} from '../../build/make_replacements.mjs';

const OUTPUT_PATH = 'output/build/client/macos';
const OUTLINE_APP_PATH = 'Debug/Outline.app';
const OUTLINE_APP_WWW_PATH = 'Contents/Resources/www';

const getUIHash = async () => {
  const hashResult = await hashElement(path.join(getRootDir(), 'client/web'), {
    files: {include: ['**/*.ts', '**/*.html', '**/*.css', '**/*.js']},
  });

  return hashResult.hash;
};

/**
 * @description Runs the cordova app in development mode.
 *
 * @param {string[]} parameters
 */
export async function main(...givenParameters) {
  const {
    _: [platform = 'macos'],
    buildMode = 'release',
    sentryDsn = 'https://public@sentry.example.com/1',
    versionName = '0.0.0-dev',
  } = minimist(givenParameters);

  if (platform !== 'macos') {
    throw new Error('This action currently only works for the MacOS platform.');
  }

  if (os.platform() !== 'darwin') {
    throw new Error('You must be on MacOS to develop for MacOS.');
  }

  const parameters = [
    'macos',
    `--buildMode=${buildMode}`,
    `--sentryDsn=${sentryDsn}`,
    `--versionName=${versionName}`,
  ];

  await runAction('client/web/build', ...parameters);
  await runAction('client/go/build', ...parameters);
  await runAction('client/src/cordova/setup', ...parameters);

  let previousUIHashResult = await getUIHash();
  let isBuilding = false;
  const server = createReloadServer(async () => {
    const currentUIHashResult = await getUIHash();

    if (isBuilding || previousUIHashResult === currentUIHashResult) {
      return false;
    }

    previousUIHashResult = currentUIHashResult;

    isBuilding = true;
    await runAction('client/web/build', ...parameters);
    isBuilding = false;

    await fs.copy(
      path.join(getRootDir(), 'client/www'),
      path.join(OUTPUT_PATH, OUTLINE_APP_PATH, OUTLINE_APP_WWW_PATH)
    );

    return true;
  });

  server.listen(0, '127.0.0.1', async () => {
    const websocketURL = `ws://${server.address().address}:${server.address().port}`;
    console.log(`LiveReload server running at ${websocketURL}`);

    await makeReplacements([
      {
        files: path.join(
          getRootDir(),
          'client/platforms/ios/**/index_cordova.html'
        ),
        from: '<app-root></app-root>',
        to: `<app-root></app-root>
  
      <script>
        try {
          const reloadSocket = new WebSocket("${websocketURL}");
  
          reloadSocket.onopen = () => console.log("LiveReload connected~");
          reloadSocket.onmessage = ({ data }) => data === "reload" && reloadSocket.close() && location.reload(true);
        } catch (e) {
          // nevermind
        }
      </script>`,
      },
    ]);

    await spawnStream(
      'xcodebuild',
      '-scheme',
      'Outline',
      '-workspace',
      path.join(getRootDir(), 'client/src/cordova/apple/client.xcworkspace'),
      `SYMROOT=${path.join(getRootDir(), OUTPUT_PATH)}`
    );

    await spawnStream(
      'open',
      path.join(getRootDir(), OUTPUT_PATH, OUTLINE_APP_PATH)
    );
  });
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
