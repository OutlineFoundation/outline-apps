#!/usr/bin/env node

/**
 * Wrapper script for `npx cap sync android` that automatically restores
 * custom dependencies to settings.gradle and capacitor.build.gradle after Capacitor CLI regenerates them.
 * 
 * Usage: npm run cap:sync:android or called automatically by build.action.mjs
 */

import { spawnStream } from '@outline/infrastructure/build/spawn_stream.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
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

    const templateContents = readFileSync(templatePath, 'utf8');
    writeFileSync(settingsGradlePath, templateContents, 'utf8');
    console.log(
        ' settings.gradle restored from settings.gradle.template'
    );
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

    const templateContents = readFileSync(templatePath, 'utf8');
    writeFileSync(capacitorBuildGradlePath, templateContents, 'utf8');
    console.log(
        ' capacitor.build.gradle restored from capacitor.build.gradle.template'
    );
}

async function main() {
    const originalCwd = process.cwd();
    process.chdir(resolve(__dirname, '..'));

    try {
        await spawnStream('npx', 'cap', 'sync', 'android');
        patchSettingsGradle();
        patchCapacitorBuildGradle();
    } catch (error) {
        console.error('\nCapacitor sync or patch failed:', error);
        process.exit(1);
    } finally {
        process.chdir(originalCwd);
    }
}

main();

