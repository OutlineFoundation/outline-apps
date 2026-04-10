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

import url from 'url';

import {runAction} from '@outline/infrastructure/build/run_action.mjs';
import webpack from 'webpack';
import WebpackServer from 'webpack-dev-server';

import webpackConfig from './webpack.config.js';

/**
 * @description Starts the Capacitor web app for development.
 */
export async function main() {
  await runAction('client/capacitor/build', 'browser');

  const config = {...webpackConfig, mode: 'development'};
  await new WebpackServer(config.devServer, webpack(config)).start();
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
