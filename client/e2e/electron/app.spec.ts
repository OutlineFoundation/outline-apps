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

// App Lifecycle (App) and VPN (Vpn) checklist items on the real Electron
// app: real main process, preload, Go backend over koffi, real renderer.
// Test titles reference the QA checklist IDs in docs/qa-automation-plan.md.

import {test, expect} from '@playwright/test';

import {launchOutlineApp, quitOutlineApp, resetToFirstLaunch} from './helpers';
import {TEST_ACCESS_KEY, TEST_SERVER_NAME, serverCard} from '../tests/helpers';

test('App.Start: the application launches and shows the first-launch UI', async () => {
  const {app, page} = await launchOutlineApp();
  try {
    await resetToFirstLaunch(page);

    // First launch: privacy acknowledgement, then the zero state.
    await page.getByTestId('privacy-accept-button').click();
    await expect(
      page.getByTestId('zero-state-add-server-button')
    ).toBeVisible();
    await expect(serverCard(page)).toHaveCount(0);
  } finally {
    await quitOutlineApp(app);
  }
});

test('Vpn.AddKey: adding and validating keys through the real Go backend', async () => {
  const {app, page} = await launchOutlineApp();
  try {
    await resetToFirstLaunch(page);
    await page.getByTestId('privacy-accept-button').click();

    // The zero state opens the add-server dialog automatically.
    const dialog = page.locator('add-access-key-dialog md-dialog[open]');
    await dialog.waitFor();
    const input = page.getByTestId('access-key-input').locator('textarea');

    // Invalid keys are rejected by the real Go ParseTunnelConfig
    // (Vpn.AddKey.InvalidKey).
    await input.fill('test://invalid-key');
    await expect(page.getByTestId('add-server-confirm-button')).toHaveAttribute(
      'disabled',
      ''
    );

    // A valid static key parses and adds a server card.
    await input.fill(TEST_ACCESS_KEY);
    await expect(
      page.getByTestId('add-server-confirm-button')
    ).not.toHaveAttribute('disabled', '');
    await page.getByTestId('add-server-confirm-button').click();

    await expect(serverCard(page)).toHaveCount(1);
    await expect(serverCard(page).locator('#server-name')).toHaveText(
      TEST_SERVER_NAME
    );

    // The server persists across an app "restart" (renderer reload reads
    // back from the same persisted storage).
    await page.reload();
    await expect(serverCard(page)).toHaveCount(1);
  } finally {
    await quitOutlineApp(app);
  }
});

test('App.Terminate: closing the window hides it, and the app quits gracefully', async () => {
  const {app} = await launchOutlineApp();

  // Closing the window hides it (tray app behavior): the app keeps running.
  const visibleAfterClose = await app.evaluate(({BrowserWindow}) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.close();
    return window.isVisible();
  });
  expect(visibleAfterClose).toBe(false);
  expect(app.process().exitCode).toBeNull();

  // Quitting (as the tray menu does) exits the process cleanly.
  await quitOutlineApp(app);
  expect(app.process().exitCode).toBe(0);
});
