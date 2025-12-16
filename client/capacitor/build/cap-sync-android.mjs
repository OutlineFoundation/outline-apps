#!/usr/bin/env node

/**
 * Wrapper script for `npx cap sync android` that automatically restores
 * custom dependencies to settings.gradle and capacitor.build.gradle after Capacitor CLI regenerates them.
 * 
 * Usage: npm run cap:sync:android or called automatically by build.action.mjs
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function patchSettingsGradle() {
    const settingsGradlePath = resolve(
        __dirname,
        '../android/settings.gradle'
    );
    const templatePath = resolve(
        __dirname,
        './templates/android/settings.gradle.template'
    );

    try {
        if (!existsSync(templatePath)) {
            console.error(
                ' settings.gradle template not found at:',
                templatePath
            );
            return;
        }

        const templateContents = readFileSync(templatePath, 'utf8');
        writeFileSync(settingsGradlePath, templateContents, 'utf8');
        console.log(
            ' settings.gradle restored from settings.gradle.template'
        );
    } catch (error) {
        console.error(
            ' Failed to patch settings.gradle:',
            error.message
        );
        process.exit(1);
    }
}

function patchCapacitorBuildGradle() {
    const capacitorBuildGradlePath = resolve(
        __dirname,
        '../android/app/capacitor.build.gradle'
    );
    const templatePath = resolve(
        __dirname,
        './templates/android/capacitor.build.gradle.template'
    );

    try {
        if (!existsSync(templatePath)) {
            console.error(
                ' capacitor.build.gradle template not found at:',
                templatePath
            );
            return;
        }

        const templateContents = readFileSync(templatePath, 'utf8');
        writeFileSync(capacitorBuildGradlePath, templateContents, 'utf8');
        console.log(
            ' capacitor.build.gradle restored from capacitor.build.gradle.template'
        );
    } catch (error) {
        console.error(
            ' Failed to patch capacitor.build.gradle:',
            error.message
        );
        process.exit(1);
    }
}

const syncProcess = spawn('npx', ['cap', 'sync', 'android'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
});

syncProcess.on('close', async (code) => {
    if (code !== 0) {
        console.error(`\nCapacitor sync failed with code ${code}`);
        process.exit(code);
    }
    patchSettingsGradle();
    patchCapacitorBuildGradle();
});

syncProcess.on('error', (error) => {
    console.error(' Failed to start Capacitor sync:', error);
    process.exit(1);
});

