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

import fs from 'fs/promises';
import path from 'path';
import url from 'url';

import {runAction} from '@outline/infrastructure/build/run_action.mjs';

import webpackConfig from './webpack.config.js';
import {writeEnvironmentJson} from './write_environment.mjs';
import {getBuildParameters} from '../build/get_build_parameters.mjs';
import {runWebpack} from '../build/run_webpack.mjs';

const capacitorDir = path.dirname(url.fileURLToPath(import.meta.url));

const SUPPORTED_PLATFORMS = new Set(['browser', 'android']);

/**
 * @description Builds the Capacitor web bundle, and for native platforms also
 * builds the tun2socks Go library that the Capacitor native projects depend on.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {platform, buildMode, versionName, buildNumber} =
    getBuildParameters(parameters);

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new TypeError(
      `Capacitor build.action.mjs supports platforms ${[...SUPPORTED_PLATFORMS].join(', ')}, got "${platform}".`
    );
  }

  if (buildMode !== 'debug') {
    throw new TypeError(
      `Capacitor ${platform} build supports only debug mode, got "${buildMode}".`
    );
  }

  const outputDir = path.resolve(capacitorDir, 'www');
  await fs.rm(outputDir, {recursive: true, force: true});
  await fs.mkdir(outputDir, {recursive: true});

  await writeEnvironmentJson(capacitorDir, versionName, buildNumber);
  await runWebpack({...webpackConfig, mode: 'development'});

  if (platform === 'android') {
    await runAction('client/go/build', 'android', ...parameters.slice(1));
  }
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
