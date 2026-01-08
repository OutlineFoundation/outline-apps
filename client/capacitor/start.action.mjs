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

import fs from 'fs/promises';
import path from 'path';
import url from 'url';

import { getRootDir } from '@outline/infrastructure/build/get_root_dir.mjs';
import { runAction } from '@outline/infrastructure/build/run_action.mjs';
import webpack from 'webpack';
import WebpackServer from 'webpack-dev-server';

import { getBrowserWebpackConfig } from '../web/get_browser_webpack_config.mjs';

const DEV_SERVER_PORT = 8080;
const DEFAULT_DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const ANDROID_DEV_SERVER_URL = `http://10.0.2.2:${DEV_SERVER_PORT}`;
const IOS_DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

function getDevServerConfigFromArgs(args) {
    const allArgs = Array.from(new Set([...args, ...process.argv.slice(2)]));
    const hasAndroidFlag = allArgs.includes('--android');
    const hasIosFlag = allArgs.includes('--ios');

    if (hasAndroidFlag) {
        return { platform: 'android', url: ANDROID_DEV_SERVER_URL };
    }
    if (hasIosFlag) {
        return { platform: 'ios', url: IOS_DEV_SERVER_URL };
    }

    // Default: localhost for both platforms (primarily useful for iOS or when
    // using a physical device that can reach the host via localhost).
    return { platform: 'default', url: DEFAULT_DEV_SERVER_URL };
}

async function updateCapacitorConfigForDev(devServerUrl) {
    const root = getRootDir();
    const configPath = path.resolve(root, 'client', 'capacitor', 'capacitor.config.json');

    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

    // Top-level server URL is what Capacitor uses on both platforms.
    config.server = {
        ...config.server,
        url: devServerUrl,
        cleartext: true,
        allowNavigation: ['*']
    };

    // Keep Android-specific server flags aligned, though Android reads the
    // top-level server.url in this project.
    config.android = config.android || {};
    config.android.server = {
        ...config.android.server,
        cleartext: true,
        allowNavigation: ['*']
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 4) + '\n', 'utf8');
    console.log(`Updated Capacitor config for hot reloading:`);
    console.log(`Dev server URL: ${devServerUrl}`);
}

async function restoreCapacitorConfig() {
    const root = getRootDir();
    const configPath = path.resolve(root, 'client', 'capacitor', 'capacitor.config.json');

    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

    // Remove platform-specific server URLs to use bundled web assets
    if (config.server && config.server.url) {
        delete config.server.url;
    }
    if (config.android && config.android.server) {
        delete config.android.server.url;
    }
    if (config.ios && config.ios.server) {
        delete config.ios.server.url;
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 4) + '\n', 'utf8');
    console.log('Restored Capacitor config to use bundled assets');
}

export async function main(...args) {
    const { platform, url: devServerUrl } = getDevServerConfigFromArgs(args);

    await updateCapacitorConfigForDev(devServerUrl);

    const cleanup = async () => {
        await restoreCapacitorConfig();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
        await runAction('client/web/build', 'capacitor-browser');
        const webpackConfig = getBrowserWebpackConfig('capacitor-browser', 'debug');

        // Ensure dev server is accessible from network (for Android emulator)
        webpackConfig.devServer = {
            ...webpackConfig.devServer,
            host: '0.0.0.0', // Listen on all interfaces
            port: DEV_SERVER_PORT,
            allowedHosts: 'all', // Allow connections from Android emulator
        };

        console.log(`\nStarting webpack dev server on port ${DEV_SERVER_PORT}`);
        console.log(`Hot reloading configured for: ${platform === 'default' ? 'default (localhost) for all platforms' : platform}`);
        console.log(`Make sure to run:`);
        console.log(`   - npx cap sync android (for Android)`);
        console.log(`   - npx cap sync ios (for iOS)`);
        console.log(`\n`);

        const server = new WebpackServer(
            webpackConfig.devServer,
            webpack(webpackConfig)
        );

        await server.start();
    } catch (error) {
        await restoreCapacitorConfig();
        throw error;
    }
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
    await main(...process.argv.slice(2));
}

