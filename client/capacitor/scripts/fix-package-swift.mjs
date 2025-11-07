#!/usr/bin/env node

/**
 * This script fixes the Package.swift file after `npx cap sync ios` overwrites it.
 * It adds the custom dependencies and sets the correct iOS platform version.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
        .package(path: "../../../../src/apple/OutlineAppleLib")`
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
} catch (error) {
    console.error('Failed to fix Package.swift:', error.message);
    process.exit(1);
}
