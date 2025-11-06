#!/usr/bin/env node

/**
 * Wrapper script for `npx cap sync ios` that automatically restores
 * custom dependencies to Package.swift after Capacitor CLI regenerates it.
 * 
 * Usage: npm run cap:sync:ios
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const syncProcess = spawn('npx', ['cap', 'sync', 'ios'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
});

syncProcess.on('close', (code) => {
    if (code !== 0) {
        console.error(`\n Capacitor sync failed with code ${code}`);
        process.exit(code);
    }

    const fixProcess = spawn('node', [join(__dirname, 'fix-package-swift.mjs')], {
        stdio: 'inherit',
        shell: true
    });

    fixProcess.on('close', (fixCode) => {
        if (fixCode !== 0) {
            console.error(`\n Post-sync hook failed with code ${fixCode}`);
            process.exit(fixCode);
        }
    });
});

syncProcess.on('error', (error) => {
    console.error('Failed to start Capacitor sync:', error);
    process.exit(1);
});

