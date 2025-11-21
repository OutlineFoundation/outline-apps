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
import rmfr from 'rmfr';

import {getBrowserWebpackConfig} from './get_browser_webpack_config.mjs';
import {getBuildParameters} from '../build/get_build_parameters.mjs';
import {runWebpack} from '../build/run_webpack.mjs';

/**
 * @description Builds the web UI for use across both electron and cordova.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {sentryDsn, platform, buildMode, versionName, buildNumber} =
    getBuildParameters(parameters);

  await rmfr(path.resolve(getRootDir(), 'www'));

  // write build environment
  await fs.mkdir(path.resolve(getRootDir(), 'www'), {recursive: true});

  if (buildMode === 'release') {
    if (versionName === '0.0.0') {
      throw new TypeError(
        'Release builds require a valid versionName, but it is set to 0.0.0.'
      );
    }

    if (!sentryDsn) {
      throw new TypeError(
        'Release builds require SENTRY_DSN, but it is not defined.'
      );
    }

    /*
      the SENTRY_DSN follows a stardard URL format:
      https://docs.sentry.io/product/sentry-basics/dsn-explainer/#the-parts-of-the-dsn
    */
    try {
      new URL(sentryDsn);
    } catch (e) {
      throw new TypeError(`The sentryDsn ${sentryDsn} is not a valid URL!`);
    }
  }

  await fs.mkdir(path.resolve(getRootDir(), 'client', 'www'), {
    recursive: true,
  });

  await fs.writeFile(
    path.resolve(getRootDir(), 'client', 'www', 'environment.json'),
    JSON.stringify({
      SENTRY_DSN: sentryDsn,
      APP_VERSION: versionName,
      APP_BUILD_NUMBER: buildNumber,
    })
  );

  await runWebpack(getBrowserWebpackConfig(platform, buildMode));
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
