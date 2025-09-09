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
import electron, {Platform} from 'electron-builder';
import minimist from 'minimist';

import {getBuildParameters} from '../build/get_build_parameters.mjs';

const ELECTRON_BUILD_DIR = 'output';
const ELECTRON_PLATFORMS = ['linux', 'windows'];

export async function main(...parameters) {
  const {platform, buildMode, versionName} = getBuildParameters(parameters);
  const {autoUpdateProvider = 'generic', autoUpdateUrl} = minimist(parameters);

  if (!ELECTRON_PLATFORMS.includes(platform)) {
    throw new TypeError(
      `The platform "${platform}" is not a valid Electron platform. It must be one of: ${ELECTRON_PLATFORMS.join(
        ', '
      )}.`
    );
  }

  if (buildMode === 'debug') {
    console.warn(
      `WARNING: building "${platform}" in [DEBUG] mode. Do not publish this build!!`
    );
  }

  if (buildMode === 'release' && !autoUpdateUrl) {
    throw new TypeError(
      "You need to add an electron-builder compliant auto-update url via an 'autoUpdateUrl' flag." +
        'See here: https://www.electron.build/configuration/publish#publishers'
    );
  }

  await runAction('client/web/build', ...parameters);
  await runAction('client/go/build', ...parameters);
  await runAction('client/electron/build_main', ...parameters);

  await fs.mkdir(
    path.join(getRootDir(), ELECTRON_BUILD_DIR, 'client', 'electron'),
    {recursive: true}
  );

  const electronConfig = JSON.parse(
    await fs.readFile(
      path.resolve(getRootDir(), 'client', 'electron', 'electron-builder.json')
    )
  );

  // build electron binary
  await electron.build({
    publish: buildMode === 'release' ? 'always' : 'never',
    targets: Platform[platform.toLocaleUpperCase()].createTarget(),
    config: {
      ...electronConfig,
      publish: autoUpdateUrl
        ? {
            provider: autoUpdateProvider,
            url: autoUpdateUrl,
          }
        : undefined,
      generateUpdatesFilesForAllChannels: buildMode === 'release',
      extraMetadata: {
        ...electronConfig.extraMetadata,
        version: versionName,
      },
    },
  });
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
