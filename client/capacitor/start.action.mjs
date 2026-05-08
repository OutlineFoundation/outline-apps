import fs from 'fs/promises';
import path from 'path';
import url from 'url';

import webpack from 'webpack';
import WebpackServer from 'webpack-dev-server';

import webpackConfig from './webpack.config.js';
import {getBuildParameters} from '../build/get_build_parameters.mjs';
import {writeEnvironmentJson} from './write_environment.mjs';

const capacitorDir = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * @description Starts the Capacitor web app for development.
 */
export async function main(...parameters) {
  const {versionName, buildNumber} = getBuildParameters(parameters);

  await fs.mkdir(path.resolve(capacitorDir, 'www'), {recursive: true});
  await writeEnvironmentJson(capacitorDir, versionName, buildNumber);

  const config = {...webpackConfig, mode: 'development'};
  await new WebpackServer(config.devServer, webpack(config)).start();
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
