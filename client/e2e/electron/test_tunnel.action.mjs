// Copyright 2026 The Outline Authors
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

import {spawn} from 'child_process';
import os from 'os';
import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

import {prepareElectronApp} from './prepare_app.mjs';

const NETNS = 'outline-e2e';

/**
 * @description Builds the Electron app for Linux and runs the desktop
 * real-tunnel E2E suite (Vpn.Connect, Net.Web, Vpn.AutoReconnect) against a
 * hermetic Shadowsocks server in an isolated network namespace. Establishes
 * a real VPN (TUN device + NetworkManager routing), so it must run as root
 * on a disposable Linux machine — CI runs it in the nightly workflow, never
 * per-PR. Extra parameters are forwarded to `playwright test`.
 *
 * @param {string[]} parameters
 */
export async function main(...parameters) {
  if (os.platform() !== 'linux') {
    throw new Error(
      'The real-tunnel Electron E2E suite only runs on Linux. ' +
        'It runs in CI on ubuntu runners (nightly_client_e2e.yml).'
    );
  }
  if (process.getuid() !== 0) {
    throw new Error(
      'The real-tunnel Electron E2E suite must run as root: it creates a ' +
        'TUN device, a network namespace, and NetworkManager connections. ' +
        'Re-run with e.g. `sudo -E env "PATH=$PATH" xvfb-run ' +
        '--auto-servernum -- npm run action client/e2e/electron/test_tunnel`.'
    );
  }

  await prepareElectronApp();

  // The hermetic tunnel server (Shadowsocks + HTTP target) lives in the
  // e2etest Go module so tunnel-server stays out of the app's go.mod.
  const serverBinary = path.join(
    getRootDir(),
    'output',
    'client',
    'e2etest',
    'e2eserver'
  );
  await spawnStream(
    'go',
    'build',
    '-C',
    path.join(getRootDir(), 'client', 'go', 'e2etest'),
    '-o',
    serverBinary,
    './cmd/e2eserver'
  );

  const setupScript = path.join(
    getRootDir(),
    'client',
    'e2e',
    'electron',
    'tunnel',
    'setup_netns.sh'
  );
  let server;
  try {
    // Inside the try so a partial namespace setup is always torn down by the
    // finally, even on a reused workflow_dispatch runner.
    await spawnStream('bash', setupScript, 'up');

    server = await startTunnelServer(serverBinary);

    await spawnStream(
      'npx',
      'playwright',
      'test',
      '--config',
      path.join(
        getRootDir(),
        'client',
        'e2e',
        'electron_tunnel.playwright.config.ts'
      ),
      ...parameters
    );
  } finally {
    server?.kill('SIGKILL');
    await spawnStream('bash', setupScript, 'down');
  }
}

/**
 * Starts e2eserver inside the network namespace and resolves once it prints
 * READY (both listeners accepting).
 *
 * @param {string} serverBinary Absolute path to the built e2eserver.
 * @returns {Promise<import('child_process').ChildProcess>}
 */
function startTunnelServer(serverBinary) {
  return new Promise((resolve, reject) => {
    const server = spawn('ip', ['netns', 'exec', NETNS, serverBinary], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let ready = false;
    const timeout = setTimeout(() => {
      server.kill('SIGKILL');
      reject(new Error('e2eserver did not become ready within 30s'));
    }, 30_000);
    server.stdout.on('data', data => {
      process.stdout.write(`[e2eserver] ${data}`);
      if (data.toString().includes('READY')) {
        ready = true;
        clearTimeout(timeout);
        resolve(server);
      }
    });
    server.on('exit', code => {
      clearTimeout(timeout);
      if (ready) {
        // A crash mid-run can no longer reject the already-settled promise;
        // surface it loudly so it isn't misread as an opaque test network
        // failure.
        console.error(`[e2eserver] exited mid-run with code ${code}`);
      } else {
        reject(new Error(`e2eserver exited early with code ${code}`));
      }
    });
  });
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
