#!/usr/bin/env node

/**
 * Wrapper script for `npx cap sync ios` that automatically restores
 * custom dependencies to Package.swift after Capacitor CLI regenerates it.
 * 
 * Usage: npm run cap:sync:ios or called automatically by build.action.mjs
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function patchCapAppSPMPackage() {
    const packageSwiftPath = resolve(
        __dirname,
        '../ios/App/CapApp-SPM/Package.swift'
    );
    const templatePath = resolve(
        __dirname,
        './templates/ios/CapApp-SPM.Package.swift.template'
    );

    try {
        if (!existsSync(templatePath)) {
            console.error(
                ' CapApp-SPM template not found at:',
                templatePath
            );
            return;
        }

        const templateContents = readFileSync(templatePath, 'utf8');
        writeFileSync(packageSwiftPath, templateContents, 'utf8');
        console.log(
            ' Package.swift restored from CapApp-SPM.Package.swift.template'
        );
    } catch (error) {
        console.error(
            ' Failed to patch CapApp-SPM Package.swift:',
            error.message
        );
        process.exit(1);
    }
}

function resizeSplashImages() {
    const splashImagesetPath = resolve(__dirname, '../ios/App/App/Assets.xcassets/Splash.imageset');

    if (!existsSync(splashImagesetPath)) {
        return false;
    }

    try {
        const images = [
            'Default@1x~universal~anyany.png',
            'Default@1x~universal~anyany-dark.png',
            'Default@2x~universal~anyany.png',
            'Default@2x~universal~anyany-dark.png',
            'Default@3x~universal~anyany.png',
            'Default@3x~universal~anyany-dark.png'
        ];
        let resized = false;
        for (const image of images) {
            const imagePath = resolve(splashImagesetPath, image);
            if (existsSync(imagePath)) {
                try {
                    const sizeInfo = execSync(`sips -g pixelWidth "${imagePath}"`, { encoding: 'utf8' });
                    const widthMatch = sizeInfo.match(/pixelWidth: (\d+)/);
                    if (widthMatch) {
                        const width = parseInt(widthMatch[1]);
                        if (image.includes('@1x')) {
                            if (width > 512) {
                                execSync(`sips -Z 512 "${imagePath}"`, { stdio: 'ignore' });
                                resized = true;
                            }
                        } else if (image.includes('@2x')) {
                            if (width > 1024) {
                                execSync(`sips -Z 1024 "${imagePath}"`, { stdio: 'ignore' });
                                resized = true;
                            }
                        } else if (image.includes('@3x')) {
                            if (width > 1536) {
                                execSync(`sips -Z 1536 "${imagePath}"`, { stdio: 'ignore' });
                                resized = true;
                            }
                        }
                    }
                } catch (error) {
                }
            }
        }
        if (resized) {
            console.log(' Resized splash images to meet iOS launch screen memory limits');
        }
        return resized;
    } catch (error) {
        console.warn('  Could not resize splash images:', error.message);
        return false;
    }
}

const syncProcess = spawn('npx', ['cap', 'sync', 'ios'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
});

syncProcess.on('close', async (code) => {
    if (code !== 0) {
        console.error(`\nCapacitor sync failed with code ${code}`);
        process.exit(code);
    }
    resizeSplashImages();
    patchCapAppSPMPackage();
});

syncProcess.on('error', (error) => {
    console.error(' Failed to start Capacitor sync:', error);
    process.exit(1);
});
