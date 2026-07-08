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

// Key management (Key) checklist items, exercised against a manual server.
// The DigitalOcean/GCP halves of these items are covered when the
// provider flows are automated (see docs/manager-qa-automation-plan.md).
// Test titles reference the QA checklist IDs.

import {test, expect} from '@playwright/test';

import {FakeShadowbox} from './fake_shadowbox';
import {
  accessKeyRows,
  addManualServer,
  englishMessage,
  loadApp,
  serverView,
  toast,
} from './helpers';

test('Key.Add: user can add multiple keys to a server', async ({page}) => {
  const fake = new FakeShadowbox();
  await fake.install(page);
  await loadApp(page);
  await addManualServer(page, fake);
  await expect(accessKeyRows(page)).toHaveCount(1);

  const addKeyButton = serverView(page).locator('#addAccessKeyButton');
  await addKeyButton.click();
  await expect(toast(page)).toContainText(
    englishMessage('notification-key-added')
  );
  await addKeyButton.click();

  await expect(accessKeyRows(page)).toHaveCount(3);

  // The keys must survive a restart (they live on the server).
  await page.reload();
  await serverView(page).waitFor();
  await expect(accessKeyRows(page)).toHaveCount(3);
});

test('Key.Delete: user can delete an existing key from a server', async ({
  page,
}) => {
  const fake = new FakeShadowbox();
  await fake.install(page);
  await loadApp(page);
  await addManualServer(page, fake);
  await serverView(page).locator('#addAccessKeyButton').click();
  await expect(accessKeyRows(page)).toHaveCount(2);

  const secondRow = accessKeyRows(page).nth(1);
  await secondRow.getByTestId('access-key-menu-button').click();
  await secondRow.getByTestId('access-key-delete-menu-item').click();

  await expect(toast(page)).toContainText(
    englishMessage('notification-key-removed')
  );
  await expect(accessKeyRows(page)).toHaveCount(1);
});

test('Key.Share: the access key is displayed so it can be shared with Outline Client', async ({
  page,
}) => {
  const fake = new FakeShadowbox();
  await fake.install(page);
  await loadApp(page);
  await addManualServer(page, fake);

  await accessKeyRows(page)
    .first()
    .getByTestId('access-key-share-button')
    .click();

  const shareDialog = page.locator('outline-share-dialog');
  await expect(shareDialog.locator('#dialog')).toBeVisible();
  // Whether this key actually admits a client connection is covered by the
  // real-Shadowbox layer of the plan; here we assert the exact key the
  // server issued is what gets shared.
  await expect(shareDialog.locator('#selectableAccessKey')).toContainText(
    fake.listKeys()[0].accessUrl
  );
});

test('Key.UsageData: per-key usage data is displayed', async ({page}) => {
  const fake = new FakeShadowbox({
    // 10^9 bytes for the server's first key: formatted as "1 GB".
    bytesTransferredByKeyId: {'0': 10 ** 9},
  });
  await fake.install(page);
  await loadApp(page);
  await addManualServer(page, fake);

  await expect(accessKeyRows(page).first()).toContainText('1 GB');
});
