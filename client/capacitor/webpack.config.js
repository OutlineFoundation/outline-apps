import path from 'path';
import {fileURLToPath} from 'url';

import CopyPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import {merge} from 'webpack-merge';

import {baseConfig, __dirname as webDir} from '../web/webpack_base.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default merge(baseConfig, {
  entry: [
    path.resolve(__dirname, 'src/polyfills.ts'),
    path.resolve(webDir, 'style.css'),
    path.resolve(__dirname, 'src/index.ts'),
  ],
  output: {
    path: path.resolve(__dirname, 'www'),
    filename: 'bundle.js',
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
            configFile: path.resolve(__dirname, 'tsconfig.json'),
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
    new CopyPlugin({
      patterns: [
        {from: path.resolve(webDir, 'assets'), to: 'assets'},
        {from: path.resolve(webDir, 'messages'), to: 'messages'},
        {
          from: path.resolve(webDir, 'favicon.ico'),
          to: 'favicon.ico',
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(__dirname, 'www/environment.json'),
          to: 'environment.json',
        },
      ],
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/index.html'),
      filename: 'index.html',
      inject: true,
    }),
  ],
  resolve: {
    alias: {
      '@web': webDir,
      '@capacitor-plugin-outline': path.resolve(
        __dirname,
        'plugins/capacitor-plugin-outline/src'
      ),
    },
  },
  devtool: 'source-map',
});
