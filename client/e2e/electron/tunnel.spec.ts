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
const TARGET_URL = 'http://10.200.1.1/';
const TARGET_RESPONSE_BODY = 'outline-e2e-target';
const VETH_HOST_INTERFACE = 'oe2e-host';

const TUNNEL_SERVER_NAME = 'Tunnel E2E Server';
const TUNNEL_ACCESS_KEY = `ss://${Buffer.from(
  `chacha20-ietf-poly1305:${SS_SECRET}`
).toString('base64url')}@${SS_HOST_PORT}/?outline=1#${encodeURIComponent(
  TUNNEL_SERVER_NAME
)}`;

/**
 * Fetches the hermetic HTTP target from the app's main process. The target
 * address is routable only from inside the server's network namespace, so
 * this succeeds if and only if traffic egresses through the tunnel.
 */
async function fetchTunnelTarget(
  app: ElectronApplication,
  timeoutMs = 5_000
): Promise<{ok: boolean; body?: string}> {
  return await app.evaluate(
    async (_electron, {url, timeoutMs}) => {
      try {
        const response = await fetch(url, {
          // This runs in the Electron main process (Node), not a browser.
          // eslint-disable-next-line compat/compat
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        });
        return {ok: response.ok, body: await response.text()};
      } catch {
        return {ok: false};
      }
    },
    {url: TARGET_URL, timeoutMs}
  );
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
    expect((await fetchTunnelTarget(app)).ok).toBe(false);

    await connectToTunnelServer(page);

    // Net.Web: traffic reaches the target through the TUN device, the Go
    // backend, and the Shadowsocks server.
    const throughTunnel = await fetchTunnelTarget(app);
    expect(throughTunnel.ok).toBe(true);
    expect(throughTunnel.body).toBe(TARGET_RESPONSE_BODY);

    // Vpn.Disconnect: the connect toggle tears the tunnel down and the
    // target becomes unreachable again. The app throttles connection state
    // changes for 600ms and silently ignores clicks inside that window
    // (see DEFAULT_SERVER_CONNECTION_STATUS_CHANGE_TIMEOUT in
    // client/web/app/app.ts), so click until the state transitions.
    const card = serverCard(page);
    const indicator = card.locator('server-connection-indicator').first();
    await expect
      .poll(
        async () => {
          await card.getByTestId('server-connect-button').click();
          return indicator.getAttribute('connection-state');
        },
        {timeout: 30_000}
      )
      .toBe('disconnected');
    expect((await fetchTunnelTarget(app)).ok).toBe(false);
  } finally {
    await quitAndDisconnect(app);
  }
});

test('Vpn.AutoReconnect: the tunnel recovers after the physical network drops', async () => {
  const {app, page} = await launchOutlineApp();
  try {
    await resetAppState(app, page);
    await connectToTunnelServer(page);
    expect((await fetchTunnelTarget(app)).ok).toBe(true);

    // Drop the link to the Shadowsocks server: traffic stops flowing.
    await exec('ip', ['link', 'set', 'dev', VETH_HOST_INTERFACE, 'down']);
    try {
      await expect
        .poll(async () => (await fetchTunnelTarget(app)).ok, {timeout: 30_000})
        .toBe(false);
    } finally {
      await exec('ip', ['link', 'set', 'dev', VETH_HOST_INTERFACE, 'up']);
    }

    // Once the network returns, the tunnel resumes relaying without user
    // action, and the UI has stayed connected throughout.
    await expect
      .poll(async () => (await fetchTunnelTarget(app)).ok, {timeout: 60_000})
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
  expect((await fetchTunnelTarget(first.app)).ok).toBe(true);

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
      .poll(async () => (await fetchTunnelTarget(app)).ok, {timeout: 60_000})
      .toBe(true);
  } finally {
    await quitAndDisconnect(app);
  }
});
