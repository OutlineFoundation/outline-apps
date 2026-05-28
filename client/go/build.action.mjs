// Copyright 2023 The Outline Authors
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

import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

import {getBuildParameters} from '../build/get_build_parameters.mjs';

// --arch uses electron-builder arch names; the Taskfile uses Go arch names.
const ELECTRON_ARCH_TO_GO_ARCH = {x64: 'amd64', arm64: 'arm64', ia32: '386'};

/**
 * @description Builds the tun2socks library for the specified platform.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {platform: targetPlatform, arch: targetArch} =
    getBuildParameters(parameters);
  const goArch = ELECTRON_ARCH_TO_GO_ARCH[targetArch] ?? targetArch;
  const targetName = goArch ? `${targetPlatform}:${goArch}` : targetPlatform;
  await spawnStream(
    'go',
    'tool',
    'task',
    '-v',
    `client:tun2socks:${targetName}`
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
