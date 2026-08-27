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

import path from 'path';
import url from 'url';

import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

import {getBuildParameters} from '../build/get_build_parameters.mjs';

const capacitorDir = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * @description Fully builds the Capacitor client: the web bundle, the
 * tun2socks native library, and the native app binary.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  const {platform, buildMode, verbose} = getBuildParameters(parameters);

  if (platform !== 'android') {
    throw new TypeError(
      `Capacitor build.action.mjs only supports the android platform, got "${platform}".`
    );
  }

  if (buildMode !== 'debug') {
    throw new TypeError(
      `Capacitor ${platform} build supports only debug mode, got "${buildMode}".`
    );
  }

  // Build the web bundle (client/capacitor/www/) that `cap sync` copies into
  // the native project.
  await runAction('client/capacitor/web_build', ...parameters);

  // `cap sync` first runs the capacitor:sync:before hook (see package.json in
  // this directory): the tun2socks gomobile AAR and client:android:configure.
  // It then copies the web assets into the native project and refreshes the
  // Capacitor plugins. The Capacitor CLI locates the project from the working
  // directory.
  process.chdir(capacitorDir);
  await spawnStream('npx', 'cap', 'sync', platform);

  // `cap build` only produces signed release builds, so invoke Gradle
  // directly for the debug APK — the same target `cap run` uses.
  const androidDir = path.resolve(capacitorDir, 'android');
  await spawnStream(
    path.join(androidDir, 'gradlew'),
    '-p',
    androidDir,
    verbose ? '--info' : '--quiet',
    'assembleDebug'
  );
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
