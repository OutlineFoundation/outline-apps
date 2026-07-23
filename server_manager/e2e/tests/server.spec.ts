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

// App lifecycle (App) and server creation/connection/destruction
// (ServerCreate, ServerConnect, ServerDestroy) checklist items.
// Test titles reference the QA checklist IDs in
// docs/manager-qa-automation-plan.md.

import {test, expect} from '@playwright/test';

import {FakeShadowbox} from './fake_shadowbox';
import {
  addManualServer,
  appRoot,
  englishMessage,
  introPage,
  loadApp,
  serverView,
  toast,
} from './helpers';

test('App.Start: first launch shows the Terms of Service, then the intro page', async ({
  page,
}) => {
  await loadApp(page, {firstLaunch: true});

  const acceptButton = appRoot(page).getByTestId('tos-accept-button');
  await expect(acceptButton).toBeVisible();
  await acceptButton.click();

  await expect(introPage(page).locator('#manual-server')).toBeVisible();

  // The acknowledgement must persist across restarts.
  await page.reload();
  await expect(introPage(page).locator('#manual-server')).toBeVisible();
  await expect(acceptButton).not.toBeVisible();
});

test('ServerCreate.Manual: user can set up a server using advanced manual steps', async ({
  page,
}) => {
  const fake = new FakeShadowbox({name: 'My Manual Server'});
  await fake.install(page);
  await loadApp(page);

  await addManualServer(page, fake);

  await expect(serverView(page)).toContainText('My Manual Server');
  // A fresh Shadowbox comes with its first access key.
  await expect(
    serverView(page).locator('access-key-data-table tbody tr')
  ).toHaveCount(1);
});

test('ServerConnect.Manual: manual servers are restored after a restart', async ({
  page,
}) => {
  const fake = new FakeShadowbox({name: 'Persistent Server'});
  await fake.install(page);
  await loadApp(page);
  await addManualServer(page, fake);

  // "Restart the manager": the repository must reload the server from
  // localStorage and reconnect to the management API.
  await page.reload();
  await serverView(page).waitFor();
  await expect(serverView(page)).toContainText('Persistent Server');
});

test('ServerDestroy.Manual: user can remove a manual server', async ({
  page,
}) => {
  const fake = new FakeShadowbox();
  await fake.install(page);
  await loadApp(page);
  await addManualServer(page, fake);

  // The overflow menu next to the server name offers "Remove server" for
  // manual servers.
  const view = serverView(page);
  await view.locator('paper-icon-button[icon="more-vert"]').click();
  await view
    .locator('paper-item', {hasText: englishMessage('server-remove')})
    .click();

  // Confirm in the modal dialog.
  await appRoot(page)
    .locator('outline-modal-dialog paper-button', {
      hasText: englishMessage('remove'),
    })
    .click();

  await expect(toast(page)).toContainText(
    englishMessage('notification-server-removed')
  );
  await expect(introPage(page).locator('#manual-server')).toBeVisible();

  // The server must stay gone after a restart.
  await page.reload();
  await expect(introPage(page).locator('#manual-server')).toBeVisible();
});
