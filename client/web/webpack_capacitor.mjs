// Copyright 2025 The Outline Authors
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
import fs from 'fs';
import path from 'path';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import CopyPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';
import {merge} from 'webpack-merge';

import {
  __dirname,
  baseConfig,
  browserConfig,
  GENERATE_CSS_RTL_LOADER,
  TS_LOADER,
} from './webpack_base.mjs';

const BABEL_LOADER = {
  loader: 'babel-loader',
  options: {
    presets: ['@babel/preset-env'],
  },
};

export default merge(baseConfig, browserConfig, {
  devServer: {
    open: '/',
    static: path.resolve(getRootDir(), 'client', 'www'),
    port: 8080,
    hot: true,
    liveReload: true,
  },
  entry: [path.resolve(__dirname, 'app', 'main.capacitor.ts')],
  target: ['web', 'es5'],
  module: {
    rules: [
      {
        test: /\.m?ts$/,
        exclude: /node_modules/,
        use: [BABEL_LOADER, TS_LOADER, GENERATE_CSS_RTL_LOADER],
      },
      {
        test: /\.m?ts$/,
        include: /node_modules/,
        use: [BABEL_LOADER, TS_LOADER],
      },
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: [BABEL_LOADER, GENERATE_CSS_RTL_LOADER],
      },
      {
        test: /\.m?js$/,
        include: /node_modules/,
        use: [BABEL_LOADER],
      },
      {
        test: /\.txt$/i,
        loader: 'raw-loader',
      },
    ],
  },
  plugins: [
    new CopyPlugin(
      [
        {from: 'assets', to: 'assets'},
        {from: 'messages', to: 'messages'},
        {
          from: path.resolve(__dirname, 'favicon.ico'),
          to: 'favicon.ico',
          noErrorOnMissing: true,
        },
      ],
      {context: __dirname}
    ),
    new webpack.DefinePlugin({
      // Statically link the Roboto font, rather than link to fonts.googleapis.com
      'window.polymerSkipLoadingFontRoboto': JSON.stringify(true),
    }),
    // Generate environment.json for development (only if it doesn't exist)
    {
      apply: compiler => {
        compiler.hooks.emit.tapAsync(
          'EnvironmentJsonPlugin',
          (compilation, callback) => {
            const envJsonPath = path.resolve(
              getRootDir(),
              'client',
              'www',
              'environment.json'
            );

            if (fs.existsSync(envJsonPath)) {
              const existingContent = fs.readFileSync(envJsonPath, 'utf8');
              compilation.assets['environment.json'] = {
                source: () => existingContent,
                size: () => existingContent.length,
              };
            } else {
              const envContent = JSON.stringify(
                {
                  SENTRY_DSN: process.env.SENTRY_DSN || '',
                  APP_VERSION: '0.0.0-dev',
                  APP_BUILD_NUMBER: '0',
                },
                null,
                2
              );

              compilation.assets['environment.json'] = {
                source: () => envContent,
                size: () => envContent.length,
              };
            }
            callback();
          }
        );
      },
    },
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.resolve(__dirname, 'index_capacitor.html'),
    }),
  ],
});
