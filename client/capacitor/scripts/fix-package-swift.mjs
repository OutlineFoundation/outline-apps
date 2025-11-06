#!/usr/bin/env node

/**
 * Post-sync hook to restore custom dependencies in Package.swift
 * that Capacitor CLI removes during sync.
 * 
 * This script is automatically run after `npx cap sync ios`.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGE_SWIFT_PATH = join(
    __dirname,
    '../ios/App/CapApp-SPM/Package.swift'
);


try {
    let content = readFileSync(PACKAGE_SWIFT_PATH, 'utf8');

    if (
        content.includes('capacitor-plugin-outline') &&
        content.includes('OutlineAppleLib') &&
        content.includes('platforms: [.iOS("15.5")]')
    ) {
        process.exit(0);
    }

    // 1. Update iOS platform version
    content = content.replace(
        /platforms: \[\.iOS\([^)]+\)\]/,
        'platforms: [.iOS("15.5")]'
    );

    // 2. Add custom dependencies
    const capacitorDep = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "6.2.1")';
    const customDeps = `${capacitorDep},
        .package(path: "../../../../plugins/capacitor-plugin-outline/ios"),
        .package(path: "../../../../src/apple/OutlineAppleLib")`;

    content = content.replace(capacitorDep, customDeps);

    // 3. Add custom dependency products
    const cordovaDep = '.product(name: "Cordova", package: "capacitor-swift-pm")';
    const customProducts = `${cordovaDep},
                .product(name: "CapacitorPluginOutline", package: "ios"),
                .product(name: "OutlineAppleLib", package: "OutlineAppleLib"),
                .product(name: "OutlineVPNExtensionLib", package: "OutlineAppleLib")`;

    content = content.replace(cordovaDep, customProducts);

    writeFileSync(PACKAGE_SWIFT_PATH, content, 'utf8');

} catch (error) {
    console.error('Failed to update Package.swift:', error.message);
    process.exit(1);
}

