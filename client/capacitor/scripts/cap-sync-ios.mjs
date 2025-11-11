#!/usr/bin/env node

/**
 * Wrapper script for `npx cap sync ios` that automatically restores
 * custom dependencies to Package.swift after Capacitor CLI regenerates it.
 * 
 * Usage: npm run cap:sync:ios or called automatically by build.action.mjs
 */

import { getRootDir } from '@outline/infrastructure/build/get_root_dir.mjs';
import { runAction } from '@outline/infrastructure/build/run_action.mjs';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
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

async function checkTun2socksFramework() {
    const rootDir = getRootDir();
    const frameworkPath = resolve(rootDir, 'output', 'client', 'apple', 'Tun2socks.xcframework');
    
    if (!existsSync(frameworkPath)) {
        console.warn('⚠️  Tun2socks.xcframework not found at:', frameworkPath);
        console.log('📦 Building Tun2socks.xcframework...');
        try {
            await runAction('client/go/build', 'ios');
            if (!existsSync(frameworkPath)) {
                throw new Error('XCFramework was not created after build');
            }
            console.log('✅ Tun2socks.xcframework built successfully!');
        } catch (error) {
            console.error('❌ Failed to build Tun2socks.xcframework:', error.message);
            console.error('💡 Please run: npm run action client/go/build ios');
            process.exit(1);
        }
    } else {
        console.log('✅ Tun2socks.xcframework found at:', frameworkPath);
    }
    
    // Verify the path in Xcode project resolves correctly
    // The project uses SOURCE_ROOT, which is the directory containing the .xcodeproj
    // From: client/capacitor/ios/App/ (SOURCE_ROOT)
    // Path: ../../../../output/client/apple/Tun2socks.xcframework (4 levels up to root)
    const sourceRoot = resolve(__dirname, '../ios/App'); // SOURCE_ROOT is the App directory
    const relativePath = '../../../../output/client/apple/Tun2socks.xcframework';
    const resolvedPath = resolve(sourceRoot, relativePath);
    
    if (!existsSync(resolvedPath)) {
        console.error('❌ Xcode project path resolution failed!');
        console.error(`   SOURCE_ROOT: ${sourceRoot}`);
        console.error(`   Resolved path: ${resolvedPath}`);
        console.error(`   Actual framework: ${frameworkPath}`);
        console.error('   The relative path in project.pbxproj may be incorrect.');
        throw new Error(`XCFramework not found at resolved path: ${resolvedPath}`);
    }
    
    console.log('✅ Xcode project path resolves correctly to:', resolvedPath);
}

async function removePluginsFolder() {
    const pluginsPath = resolve(__dirname, '../ios/App/App/Plugins');

    try {
        await rm(pluginsPath, { recursive: true, force: true });
        console.log('Plugins folder removed successfully!');
    } catch (error) {
        // Ignore error if folder doesn't exist
        if (error.code !== 'ENOENT') {
            console.error('❌ Failed to remove Plugins folder:', error.message);
        }
    }
}

// Check for Tun2socks.xcframework before syncing
await checkTun2socksFramework();

const syncProcess = spawn('npx', ['cap', 'sync', 'ios'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
});

syncProcess.on('close', async (code) => {
    if (code !== 0) {
        console.error(`\n❌ Capacitor sync failed with code ${code}`);
        process.exit(code);
    }

    fixPackageSwift();
    await removePluginsFolder();
});

syncProcess.on('error', (error) => {
    console.error('❌ Failed to start Capacitor sync:', error);
    process.exit(1);
});
