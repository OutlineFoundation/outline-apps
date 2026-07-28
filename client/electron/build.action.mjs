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

// Per-platform packaging config keyed by `platform`. Arch validation /
// translation lives upstream in getBuildParameters (SUPPORTED_BUILDS).
// electron-builder.json holds only the arch-independent config; everything
// that depends on the requested architecture is filled in from this table
// at build time.
const ELECTRON_PLATFORM_PACKAGING = {
  linux: {
    builderKey: 'linux',
    targetFormat: 'deb',
    // Binary files to keep outside the asar archive so they can be loaded at runtime.
    binaryFiles: ['libbackend.so', 'tun2socks'],
    // Non-binary files to include in the package alongside the Go output.
    extraPackageFiles: ['client/electron/icons/png'],
  },
  windows: {
    builderKey: 'win',
    targetFormat: 'nsis',
    // Binary files to keep outside the asar archive so they can be loaded at runtime.
    binaryFiles: ['backend.dll', 'tun2socks.exe'],
    extraPackageFiles: [],
  },
};

export async function main(...parameters) {
  const {platform, buildMode, versionName, arch, goArch} =
    getBuildParameters(parameters);
  const {autoUpdateProvider = 'generic', autoUpdateUrl} = minimist(parameters);

  const packaging = ELECTRON_PLATFORM_PACKAGING[platform];
  if (!packaging) {
    throw new TypeError(
      `The platform "${platform}" is not a valid Electron platform. It must be one of: ${Object.keys(
        ELECTRON_PLATFORM_PACKAGING
      ).join(', ')}.`
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

  const binaryDir = `output/client/${platform}-${goArch}`;

  // Keep the Go-built binaries outside the asar archive so they're loadable
  // at runtime (CGo .so / .dll can't be loaded from inside asar).
  electronConfig.asarUnpack = packaging.binaryFiles.map(
    f => `${binaryDir}/${f}`
  );
  electronConfig[packaging.builderKey].files = [
    ...packaging.extraPackageFiles,
    binaryDir,
    `!${binaryDir}/*.h`,
  ];
  electronConfig[packaging.builderKey].target = [
    {arch, target: packaging.targetFormat},
  ];

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
