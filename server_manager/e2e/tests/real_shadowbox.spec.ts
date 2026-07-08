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

// QA automation Layer 2 (see docs/manager-qa-automation-plan.md): the
// manual-server journey against a *real* Shadowbox container instead of the
// route-intercepted fake, proving the management-API contract the fake
// assumes. Run via `npm run action server_manager/e2e/test_real`, which
// starts the container and sets SHADOWBOX_API_URL (and, optionally,
// SHADOWBOX_CERT_SHA256 with the hex fingerprint of its TLS certificate).
// Without SHADOWBOX_API_URL this file is skipped.

import {test, expect} from '@playwright/test';

import {
  accessKeyRows,
  appRoot,
  englishMessage,
  introPage,
  loadApp,
  serverView,
  toast,
} from './helpers';

const API_URL = process.env.SHADOWBOX_API_URL;
const CERT_SHA256 = process.env.SHADOWBOX_CERT_SHA256;

test.skip(
  !API_URL,
  'SHADOWBOX_API_URL is not set; run via `npm run action server_manager/e2e/test_real`'
);

// One journey covering the manual-server checklist items end to end. The
// container is shared state, so the steps build on each other in order
// rather than as isolated tests.
test('ServerCreate.Manual, Key.Add, Key.Share, Key.Delete, ServerDestroy.Manual: full journey against a real Shadowbox', async ({
  page,
}) => {
  await loadApp(page);

  // ServerCreate.Manual: paste the real server's config.
  await introPage(page).locator('#manual-server').click();
  const manualEntry = appRoot(page).locator('#manualEntry');
  await manualEntry
    .locator('#serverConfig')
    .locator('textarea')
    .fill(JSON.stringify({apiUrl: API_URL, certSha256: CERT_SHA256}));
  await manualEntry.locator('#doneButton').click();
  await serverView(page).waitFor({timeout: 30000});

  // A fresh Shadowbox starts with one access key.
  const rows = accessKeyRows(page);
  await expect(rows).not.toHaveCount(0, {timeout: 15000});
  const initialKeyCount = await rows.count();

  // Key.Add.
  await serverView(page).locator('#addAccessKeyButton').click();
  await expect(toast(page)).toContainText(
    englishMessage('notification-key-added')
  );
  await expect(rows).toHaveCount(initialKeyCount + 1);

  // Key.Share: a real ss:// access key is displayed for sharing.
  await rows.first().getByTestId('access-key-share-button').click();
  const shareDialog = page.locator('outline-share-dialog');
  await expect(shareDialog.locator('#dialog')).toBeVisible();
  await expect(shareDialog.locator('#selectableAccessKey')).toContainText(
    'ss://'
  );
  await shareDialog.locator('#doneButton').click();

  // Key.Delete: remove the key we just added.
  const addedRow = rows.nth(initialKeyCount);
  await addedRow.getByTestId('access-key-menu-button').click();
  await addedRow.getByTestId('access-key-delete-menu-item').click();
  await expect(toast(page)).toContainText(
    englishMessage('notification-key-removed')
  );
  await expect(rows).toHaveCount(initialKeyCount);

  // ServerDestroy.Manual: remove the server from the manager.
  await serverView(page).locator('paper-icon-button[icon="more-vert"]').click();
  await serverView(page)
    .locator('paper-item', {hasText: englishMessage('server-remove')})
    .click();
  await appRoot(page)
    .locator('outline-modal-dialog paper-button', {
      hasText: englishMessage('remove'),
    })
    .click();
  await expect(introPage(page).locator('#manual-server')).toBeVisible();
});
