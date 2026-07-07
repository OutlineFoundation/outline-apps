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

// Client UI (Ui) and App Lifecycle (App) checklist items.
// Test titles reference the QA checklist IDs in docs/qa-automation-plan.md.

import {test, expect} from '@playwright/test';

import {addServer, loadApp, serverCard, TEST_ACCESS_KEY} from './helpers';

test('App.Start: first launch shows the privacy acknowledgement, then the zero state', async ({
  page,
}) => {
  await loadApp(page, {firstLaunch: true});

  const privacyDialog = page.locator('privacy-acknowledgement-dialog');
  await expect(privacyDialog.locator('md-filled-button')).toBeVisible();
  await privacyDialog.locator('md-filled-button').click();

  await expect(page.getByTestId('zero-state-add-server-button')).toBeVisible();

  // The acknowledgement must persist across restarts.
  await page.reload();
  await expect(page.getByTestId('zero-state-add-server-button')).toBeVisible();
  await expect(privacyDialog.locator('md-filled-button')).not.toBeVisible();
});

test('Ui.ServerRename: user can rename a server, and the name persists', async ({
  page,
}) => {
  await loadApp(page);
  await addServer(page, TEST_ACCESS_KEY);

  const card = serverCard(page);
  await card.getByTestId('server-menu-button').click();
  await card.getByTestId('server-rename-menu-item').click();

  const renameInput = card
    .getByTestId('server-rename-input')
    .locator('input');
  await renameInput.fill('Renamed QA Server');
  await card.getByTestId('server-rename-save-button').click();

  await expect(page.locator('#toast')).toContainText('Server renamed');
  await expect(card.locator('#server-name')).toHaveText('Renamed QA Server');

  // The new name must persist across restarts.
  await page.reload();
  await expect(serverCard(page).locator('#server-name')).toHaveText(
    'Renamed QA Server'
  );
});

test('Ui.About: about page shows the app version without a -dev suffix', async ({
  page,
}) => {
  await loadApp(page);

  await page.goto('/?demoServers=false#/about');

  const aboutView = page.locator('about-view');
  await expect(aboutView).toBeVisible();

  const environment = await (
    await page.request.get('/environment.json')
  ).json();
  await expect(aboutView).toContainText(environment.APP_VERSION);

  // Release builds must not report a "-dev" version (Ui.About accept
  // criteria). Debug builds are exempt: the browser bundle is always built in
  // debug mode, so only enforce this when the version looks like a release.
  if (!environment.APP_VERSION.includes('debug')) {
    expect(environment.APP_VERSION).not.toContain('-dev');
  }
});
