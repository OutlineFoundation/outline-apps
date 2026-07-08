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

// Real-tunnel VPN (Vpn) and network (Net) checklist items on the real
// Electron app: a genuine TUN device, NetworkManager routing, and traffic
// through a hermetic Shadowsocks server in an isolated network namespace
// (see tunnel/setup_netns.sh and client/go/e2etest/cmd/e2eserver). Requires
// root; run via `npm run action client/e2e/electron/test_tunnel`.
//
// Test titles reference the QA checklist IDs in docs/qa-automation-plan.md.
//
// A note on Vpn.AutoReconnect: the Linux backend has no network-change
// monitor (see client/go/outline/vpn), so a network interruption never
// surfaces a "reconnecting" UI state — the tunnel simply resumes relaying
// once the network returns. The RECONNECTING status only occurs when the
// app relaunches after an unclean shutdown while connected. Both halves are
// covered below by asserting on actual traffic through the tunnel.

import {execFile} from 'child_process';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';
import {promisify} from 'util';

import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import {launchOutlineApp, quitOutlineApp} from './helpers';
import {addServer, serverCard} from '../tests/helpers';

const exec = promisify(execFile);

// These constants mirror tunnel/setup_netns.sh and the e2eserver defaults.
const SS_HOST_PORT = '10.200.0.2:19999';
const SS_SECRET = 'outline-e2e-tunnel';
const TARGET_HOST = '10.200.1.1';
const TARGET_RESPONSE_BODY = 'outline-e2e-target';
const VETH_HOST_INTERFACE = 'oe2e-host';

const TUNNEL_SERVER_NAME = 'Tunnel E2E Server';
const TUNNEL_ACCESS_KEY = `ss://${Buffer.from(
  `chacha20-ietf-poly1305:${SS_SECRET}`
).toString('base64url')}@${SS_HOST_PORT}/?outline=1#${encodeURIComponent(
  TUNNEL_SERVER_NAME
)}`;

/**
 * Requests the hermetic HTTP target and reports whether it responded.
 *
 * The target address is on the server namespace's loopback, so it has no
 * route from this (root-namespace) process except through the VPN's TUN
 * device: system-wide policy routing sends any non-fwmark-protected traffic
 * there once the tunnel is up. So a successful response proves traffic
 * egresses through the tunnel, and a failure proves it does not. Plain Node
 * `http` is used rather than the app's Chromium `fetch` so the probe is a
 * direct, deterministic kernel-routed request with no renderer caching.
 */
function probeTarget(timeoutMs = 4_000): Promise<{ok: boolean; body: string}> {
  return new Promise(resolve => {
    const request = http.get(
      {host: TARGET_HOST, port: 80, path: '/', timeout: timeoutMs},
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (body += chunk));
        response.on('end', () =>
          resolve({ok: response.statusCode === 200, body})
        );
      }
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ok: false, body: ''}));
  });
}

/**
 * Resets the app to a known logged-out-of-VPN state: no persisted servers or
 * settings in the renderer (one-time dialogs pre-dismissed), and no saved
 * tunnel in the main process (which would trigger auto-reconnect on the next
 * launch).
 */
async function resetAppState(app: ElectronApplication, page: Page) {
  // The evaluate callback runs outside any CommonJS module scope, where
  // `require` is not defined, so read the path out and delete the
  // TunnelStore file (client/electron/tunnel_store.ts) from the test
  // process, which runs as root.
  const userDataPath = await app.evaluate(({app: electronApp}) =>
    electronApp.getPath('userData')
  );
  await fs.rm(path.join(userDataPath, 'connection_store'), {force: true});
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        'privacy-ack': 'true',
        'auto-connect-dialog-dismissed': 'true',
        'vpn-warning-dismissed': 'true',
      })
    );
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Quits through the app's real quit path (the tray menu's handler), which
 * disconnects the VPN and clears the saved tunnel before exiting. Falls back
 * to the destroy-windows quit if the graceful path stalls.
 */
async function quitAndDisconnect(app: ElectronApplication) {
  const exited = new Promise<void>(resolve => {
    app.process().once('exit', () => resolve());
  });
  app
    .evaluate(({ipcMain}) => {
      ipcMain.emit('outline-ipc-quit-app');
    })
    .catch(() => {
      // Expected: the IPC channel drops as the app exits.
    });
  const gracefulExit = await Promise.race([
    exited.then(() => true),
    new Promise<false>(resolve => setTimeout(() => resolve(false), 15_000)),
  ]);
  if (!gracefulExit) {
    await quitOutlineApp(app);
  }
}

/** Adds the tunnel server and connects, waiting for the connected state. */
async function connectToTunnelServer(page: Page) {
  await addServer(page, TUNNEL_ACCESS_KEY);
  const card = serverCard(page);
  await expect(card).toHaveCount(1);

  await card.getByTestId('server-connect-button').click();
  await expect(
    card.locator('server-connection-indicator').first()
  ).toHaveAttribute('connection-state', 'connected', {timeout: 60_000});
}

test('Vpn.Connect & Net.Web & Vpn.Disconnect: a real tunnel routes traffic to the hermetic target', async () => {
  const {app, page} = await launchOutlineApp();
  try {
    await resetAppState(app, page);

    // Before connecting, the target must be unreachable: it only has a
    // route from inside the server's network namespace.
    expect((await probeTarget()).ok).toBe(false);

    await connectToTunnelServer(page);

    // Net.Web: traffic reaches the target through the TUN device, the Go
    // backend, and the Shadowsocks server. Poll to give the freshly
    // installed routing rules a moment to take effect.
    await expect
      .poll(async () => (await probeTarget()).ok, {timeout: 20_000})
      .toBe(true);
    expect((await probeTarget()).body).toBe(TARGET_RESPONSE_BODY);

    // Vpn.Disconnect: the connect toggle tears the tunnel down and the
    // target becomes unreachable again. Only click while still 'connected':
    // the app throttles connection state changes for 600ms and silently
    // ignores clicks inside that window (see
    // DEFAULT_SERVER_CONNECTION_STATUS_CHANGE_TIMEOUT in
    // client/web/app/app.ts), so the first click can be dropped and needs
    // retrying — but a real tunnel takes seconds to tear down, and clicking
    // again once it has left the 'connected' state would toggle it back into
    // reconnecting. So click only when still connected, then just wait.
    const card = serverCard(page);
    const indicator = card.locator('server-connection-indicator').first();
    await expect
      .poll(
        async () => {
          const state = await indicator.getAttribute('connection-state');
          if (state === 'connected') {
            await card.getByTestId('server-connect-button').click();
          }
          return state;
        },
        {timeout: 30_000}
      )
      .toBe('disconnected');
    await expect
      .poll(async () => (await probeTarget()).ok, {timeout: 20_000})
      .toBe(false);
  } finally {
    await quitAndDisconnect(app);
  }
});

test('Vpn.AutoReconnect: the tunnel recovers after the physical network drops', async () => {
  const {app, page} = await launchOutlineApp();
  try {
    await resetAppState(app, page);
    await connectToTunnelServer(page);
    await expect
      .poll(async () => (await probeTarget()).ok, {timeout: 20_000})
      .toBe(true);

    // Drop the link to the Shadowsocks server: traffic stops flowing.
    await exec('ip', ['link', 'set', 'dev', VETH_HOST_INTERFACE, 'down']);
    try {
      await expect
        .poll(async () => (await probeTarget()).ok, {timeout: 30_000})
        .toBe(false);
    } finally {
      await exec('ip', ['link', 'set', 'dev', VETH_HOST_INTERFACE, 'up']);
    }

    // Once the network returns, the tunnel resumes relaying without user
    // action, and the UI has stayed connected throughout.
    await expect
      .poll(async () => (await probeTarget()).ok, {timeout: 60_000})
      .toBe(true);
    await expect(
      serverCard(page).locator('server-connection-indicator').first()
    ).toHaveAttribute('connection-state', 'connected');
  } finally {
    await quitAndDisconnect(app);
  }
});

test('Vpn.AutoReconnect: the client reconnects on launch after an unclean shutdown', async () => {
  // Connect, then simulate a crash/shutdown while connected: the saved
  // tunnel (TunnelStore) must make the next launch reconnect on its own.
  const first = await launchOutlineApp();
  await resetAppState(first.app, first.page);
  await connectToTunnelServer(first.page);
  await expect
    .poll(async () => (await probeTarget()).ok, {timeout: 20_000})
    .toBe(true);

  const firstExited = new Promise<void>(resolve => {
    first.app.process().once('exit', () => resolve());
  });
  first.app.process().kill('SIGKILL');
  await firstExited;

  const {app} = await launchOutlineApp();
  try {
    // No UI interaction: reaching the target proves the app re-established
    // the tunnel from the saved state (index.ts reconnects at startup with
    // a RECONNECTING → CONNECTED status transition).
    await expect
      .poll(async () => (await probeTarget()).ok, {timeout: 60_000})
      .toBe(true);
  } finally {
    await quitAndDisconnect(app);
  }
});
