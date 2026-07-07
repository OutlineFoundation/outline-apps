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

// VPN Connection (Vpn) checklist items, UI level.
// Test titles reference the QA checklist IDs in docs/qa-automation-plan.md.

import {test, expect} from '@playwright/test';

import {
  addServer,
  loadApp,
  serverCard,
  TEST_ACCESS_KEY,
  TEST_SERVER_NAME,
} from './helpers';

test('Vpn.Default.Clean: no servers on first launch', async ({page}) => {
  await loadApp(page);

  await expect(page.getByTestId('zero-state-add-server-button')).toBeVisible();
  await expect(serverCard(page)).toHaveCount(0);
});

test('Vpn.AddKey: user can add a server key, and it persists across restarts', async ({
  page,
}) => {
  await loadApp(page);
  await addServer(page, TEST_ACCESS_KEY);

  await expect(serverCard(page)).toHaveCount(1);
  await expect(serverCard(page).locator('#server-name')).toHaveText(
    TEST_SERVER_NAME
  );
  await expect(page.locator('#toast')).toContainText('Added server');

  // "Restart" the application: the server must still be there.
  await page.reload();
  await expect(serverCard(page)).toHaveCount(1);
  await expect(serverCard(page).locator('#server-name')).toHaveText(
    TEST_SERVER_NAME
  );
});

test('Vpn.AddKey.InvalidKey: an invalid key is rejected with an error', async ({
  page,
}) => {
  await loadApp(page);

  const dialog = page.locator('add-access-key-dialog md-dialog[open]');
  await dialog.waitFor();
  await page
    .getByTestId('access-key-input')
    .locator('textarea')
    .fill('test://invalid-key');

  await expect(
    page.getByRole('alert').getByText('Invalid access key.')
  ).toBeVisible();
  // toBeDisabled() only inspects native form controls; md-filled-button is a
  // custom element, so assert on its reflected disabled attribute instead.
  await expect(page.getByTestId('add-server-confirm-button')).toHaveAttribute(
    'disabled',
    ''
  );
});

test('Vpn.Connect & Vpn.Disconnect: connect toggle drives connection state', async ({
  page,
}) => {
  await loadApp(page);
  await addServer(page, TEST_ACCESS_KEY);

  const card = serverCard(page);
  const indicator = card.locator('server-connection-indicator').first();
  const connectButton = card.getByTestId('server-connect-button');

  await connectButton.click();
  await expect(indicator).toHaveAttribute('connection-state', 'connected');
  await expect(connectButton).toContainText(/disconnect/i);

  // The app throttles connection state changes for 600ms (see
  // DEFAULT_SERVER_CONNECTION_STATUS_CHANGE_TIMEOUT in client/web/app/app.ts);
  // a disconnect click inside that window is intentionally ignored.
  await page.waitForTimeout(700);

  await connectButton.click();
  await expect(indicator).toHaveAttribute('connection-state', 'disconnected');
  await expect(connectButton).not.toContainText(/disconnect/i);
  await expect(connectButton).toContainText(/connect/i);
});
