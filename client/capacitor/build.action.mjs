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

import webpackConfig from './webpack.config.js';
import {getBuildParameters} from '../build/get_build_parameters.mjs';
import {getWebpackBuildMode} from '../build/get_webpack_build_mode.mjs';
import {runWebpack} from '../build/run_webpack.mjs';

const capacitorDir = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * @description Builds the Capacitor web bundle (browser / shared www output).
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {platform, buildMode, versionName, buildNumber, sentryDsn} =
    getBuildParameters(parameters);

  if (platform !== 'browser') {
    throw new TypeError(
      `Capacitor build.action.mjs currently supports only platform "browser", got "${platform}".`
    );
  }

  await buildWebBundle({
    buildMode,
    versionName,
    buildNumber,
    sentryDsn,
  });
}

async function buildWebBundle({
  buildMode,
  versionName,
  buildNumber,
  sentryDsn,
}) {
  validateReleaseBuildParams(buildMode, versionName, sentryDsn);
  await writeEnvironmentJson(versionName, buildNumber, sentryDsn);
  const mode = getWebpackBuildMode(buildMode);
  await runWebpack({...webpackConfig, mode});
}

function validateReleaseBuildParams(buildMode, versionName, sentryDsn) {
  if (buildMode !== 'release') {
    return;
  }
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
  try {
    new URL(sentryDsn);
  } catch {
    throw new TypeError(`The sentryDsn ${sentryDsn} is not a valid URL!`);
  }
}

async function writeEnvironmentJson(versionName, buildNumber, sentryDsn) {
  process.env.APP_VERSION = versionName;
  process.env.APP_BUILD_NUMBER = String(buildNumber);
  process.env.SENTRY_DSN = sentryDsn ?? '';

  const environmentJson = JSON.stringify(
    {
      APP_VERSION: process.env.APP_VERSION,
      APP_BUILD_NUMBER: process.env.APP_BUILD_NUMBER,
      SENTRY_DSN: process.env.SENTRY_DSN,
    },
    null,
    2
  );
  const outputEnvironmentPath = path.resolve(
    capacitorDir,
    'www',
    'environment.json'
  );
  await fs.mkdir(path.dirname(outputEnvironmentPath), {recursive: true});
  await fs.writeFile(outputEnvironmentPath, environmentJson);
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
