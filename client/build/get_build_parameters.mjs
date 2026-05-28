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

import minimist from 'minimist';

const VALID_PLATFORMS = [
  'linux',
  'windows',
  'ios',
  'macos',
  'android',
  'browser',
];
const VALID_BUILD_MODES = ['debug', 'release'];

// --arch values accepted per platform. Uses electron-builder's arch
// vocabulary; downstream (the Taskfile, our output/client/<platform>-<arch>
// directories) uses Go arch names — translated where needed via
// ELECTRON_ARCH_TO_GO_ARCH in build.action.mjs. Platforms not in this map
// don't accept --arch.
const VALID_ARCHITECTURES_BY_PLATFORM = {
  linux: ['x64', 'arm64'],
  windows: ['ia32', 'arm64'],
};

const MS_PER_HOUR = 1000 * 60 * 60;

/*
  Inputs:
  => cliParameters: the list of action arguments passed in

  Outputs:
  => an object containing the specificed platform and buildMode.
*/
export function getBuildParameters(cliArguments) {
  const {
    _: [platform = 'browser'],
    buildMode = 'debug',
    verbose = false,
    versionName = '0.0.0',
    sentryDsn = process.env.SENTRY_DSN,
    arch = '',
  } = minimist(cliArguments);

  if (platform && !VALID_PLATFORMS.includes(platform)) {
    throw new TypeError(
      `Platform "${platform}" is not a valid target for Outline Client. Must be one of ${VALID_PLATFORMS.join(', ')}`
    );
  }

  if (arch) {
    const validArchs = VALID_ARCHITECTURES_BY_PLATFORM[platform];
    if (!validArchs) {
      throw new TypeError(
        `Architecture "${arch}" cannot be specified for platform "${platform}".`
      );
    }
    if (!validArchs.includes(arch)) {
      throw new TypeError(
        `Architecture "${arch}" is not a valid target for ${platform}. Must be one of ${validArchs.join(', ')}`
      );
    }
  }

  if (buildMode && !VALID_BUILD_MODES.includes(buildMode)) {
    throw new TypeError(
      `Build mode "${buildMode}" is not a valid build mode for Outline Client. Must be one of ${VALID_BUILD_MODES.join(
        ', '
      )}`
    );
  }

  return {
    platform,
    buildMode,
    verbose,
    versionName:
      buildMode === 'release' ? versionName : `${versionName}-${buildMode}`,
    sentryDsn,
    buildNumber: Math.floor(Date.now() / MS_PER_HOUR),
    arch,
  };
}
