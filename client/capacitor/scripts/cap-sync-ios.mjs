#!/usr/bin/env node

/**
 * Wrapper script for `npx cap sync ios` that automatically restores
 * custom dependencies to Package.swift after Capacitor CLI regenerates it.
 * 
 * Usage: npm run cap:sync:ios or called automatically by build.action.mjs
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function fixPackageSwift() {
    const packageSwiftPath = resolve(__dirname, '../ios/App/CapApp-SPM/Package.swift');

    try {
        let content = readFileSync(packageSwiftPath, 'utf8');

        content = content.replace(
            /platforms: \[\.iOS\(\.v15\)\]/,
            'platforms: [.iOS("15.5")]'
        );

        if (!content.includes('capacitor-plugin-outline')) {
            content = content.replace(
                /dependencies: \[\s*\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", exact: "[^"]+"\)/,
                `dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "6.2.1"),
        .package(path: "../../../../capacitor/plugins/capacitor-plugin-outline/ios"),
        .package(path: "../../../../capacitor/plugins/apple/OutlineAppleLib")`
            );
        }

        if (!content.includes('CapacitorPluginOutline')) {
            content = content.replace(
                /dependencies: \[\s*\.product\(name: "Capacitor", package: "capacitor-swift-pm"\),\s*\.product\(name: "Cordova", package: "capacitor-swift-pm"\)/,
                `dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorPluginOutline", package: "ios"),
                .product(name: "OutlineAppleLib", package: "OutlineAppleLib")`
            );
        }

        writeFileSync(packageSwiftPath, content, 'utf8');
        console.log('✅ Package.swift fixed successfully!');
    } catch (error) {
        console.error('❌ Failed to fix Package.swift:', error.message);
        process.exit(1);
    }
}

const syncProcess = spawn('npx', ['cap', 'sync', 'ios'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
});

syncProcess.on('close', (code) => {
    if (code !== 0) {
        console.error(`\n❌ Capacitor sync failed with code ${code}`);
        process.exit(code);
    }

    fixPackageSwift();
});

syncProcess.on('error', (error) => {
    console.error('❌ Failed to start Capacitor sync:', error);
    process.exit(1);
});
