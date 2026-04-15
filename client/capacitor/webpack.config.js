/**
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import {fileURLToPath} from 'url';

import CopyPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: [
    path.resolve(__dirname, 'src/polyfills.ts'),
    path.resolve(__dirname, '../web/style.css'),
    path.resolve(__dirname, 'src/index.ts'),
  ],
  output: {
    path: path.resolve(__dirname, 'www'),
    filename: 'bundle.js',
    clean: true,
  },
  devServer: {
    static: {
      directory: path.resolve(__dirname, 'www'),
    },
    port: 8080,
    hot: true,
    host: '0.0.0.0',
    allowedHosts: 'all',
    open: false,
  },
  module: {
    rules: [
      {
        test: /\.m?ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, '../web/tsconfig.json'),
            transpileOnly: true,
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      {
        resourceQuery: /raw/,
        type: 'asset/source',
      },
      {
        test: /\.txt$/i,
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    new CopyPlugin(
      [
        {from: path.resolve(__dirname, '../web/assets'), to: 'assets'},
        {from: path.resolve(__dirname, '../web/messages'), to: 'messages'},
        {
          from: path.resolve(__dirname, '../web/favicon.ico'),
          to: 'favicon.ico',
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(__dirname, 'www/environment.json'),
          to: 'environment.json',
        },
      ],
      {context: __dirname}
    ),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/index.html'),
      filename: 'index.html',
      inject: true,
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, '../web'),
    },
  },
  devtool: 'source-map',
};
