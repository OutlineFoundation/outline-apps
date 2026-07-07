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

import type {Page} from '@playwright/test';

// TEST-NET-3 (RFC 5737) address: never routable, and distinct from the fake
// VPN API's "broken" (192.0.2.1) and "unreachable" (10.0.0.24) trigger
// addresses (see client/web/app/outline_server_repository/vpn.fake.ts).
export const TEST_SERVER_HOST = '203.0.113.10';
export const TEST_SERVER_NAME = 'QA Test Server';

// base64("chacha20-ietf-poly1305:E2eTestPassword1")
export const TEST_ACCESS_KEY = `ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpFMmVUZXN0UGFzc3dvcmQx@${TEST_SERVER_HOST}:12345/?outline=1#${encodeURIComponent(
  TEST_SERVER_NAME
)}`;

/**
 * Locator matching any server card variant: the list renders
 * server-hero-card for a single server and server-row-card for multiple
 * (see client/web/views/servers_view/server_list/index.ts).
 */
export function serverCard(page: Page) {
  return page.locator('server-hero-card, server-row-card, server-card');
}

/**
 * Loads the app with a clean localStorage.
 *
 * Unless `firstLaunch` is set, the privacy acknowledgement and other one-time
 * dialogs are pre-dismissed so tests can go straight to the behavior under
 * test. `?demoServers=false` suppresses the demo servers the browser build
 * normally seeds, so the app starts in the true first-launch zero state.
 */
export async function loadApp(
  page: Page,
  {firstLaunch = false}: {firstLaunch?: boolean} = {}
): Promise<void> {
  if (!firstLaunch) {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'settings',
        JSON.stringify({
          'privacy-ack': 'true',
          'auto-connect-dialog-dismissed': 'true',
          'vpn-warning-dismissed': 'true',
        })
      );
    });
  }
  await page.goto('/?demoServers=false');
}

/**
 * Adds a server through the add-access-key dialog.
 *
 * On a zero-state launch the app opens the dialog automatically; otherwise
 * this opens it via the header's add button.
 */
export async function addServer(page: Page, accessKey: string): Promise<void> {
  const dialog = page.locator('add-access-key-dialog md-dialog[open]');
  try {
    await dialog.waitFor({timeout: 2000});
  } catch {
    await page.getByTestId('add-server-button').click();
    await dialog.waitFor();
  }
  await page
    .getByTestId('access-key-input')
    .locator('textarea')
    .fill(accessKey);
  await page.getByTestId('add-server-confirm-button').click();
}
