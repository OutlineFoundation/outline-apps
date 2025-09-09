// Copyright 2020 The Outline Authors
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

import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';
import {merge} from 'webpack-merge';

import {
  baseConfig,
  browserConfig,
  __dirname,
  TS_LOADER,
  GENERATE_CSS_RTL_LOADER,
} from './webpack_base.mjs';

export default merge(baseConfig, browserConfig, {
  entry: [path.resolve(__dirname, 'app', 'main.electron.ts')],
  target: 'electron-renderer',
  module: {
    rules: [
      {
        test: /\.m?ts$/,
        exclude: /node_modules/,
        use: [TS_LOADER, GENERATE_CSS_RTL_LOADER],
      },
      {
        test: /\.m?ts$/,
        include: /node_modules/,
        use: [TS_LOADER],
      },
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: [GENERATE_CSS_RTL_LOADER],
      },
      {
        test: /\.txt$/i,
        loader: 'raw-loader',
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      // Statically link the Roboto font, rather than link to fonts.googleapis.com
      'window.polymerSkipLoadingFontRoboto': JSON.stringify(true),
    }),
    new HtmlWebpackPlugin({
      filename: 'index_electron.html',
      template: path.resolve(__dirname, 'index_electron.html'),
    }),
  ],
});
