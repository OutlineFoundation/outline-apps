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

// GCP checklist items (ServerCreate/ServerConnect/ServerDestroy.GCP),
// against a route-intercepted GCP API surface (see fake_gcp.ts). The
// browser build's OAuth stub asks for the refresh token via window.prompt,
// which the tests answer through Playwright's dialog handler — everything
// after that runs the app's real GCP code over the intercepted APIs.
// Test titles reference the QA checklist IDs in
// docs/manager-qa-automation-plan.md.

import {test, expect, type Page} from '@playwright/test';

import {FakeGcp} from './fake_gcp';
import {FakeShadowbox} from './fake_shadowbox';
import {
  accessKeyRows,
  appRoot,
  englishMessage,
  introPage,
  loadApp,
  serverView,
  toast,
} from './helpers';

/** Clicks the GCP intro card and answers the refresh-token prompt. */
async function connectGcp(page: Page): Promise<void> {
  page.once('dialog', dialog => void dialog.accept('fake-gcp-refresh-token'));
  // Two #gcp cards exist (new flow + hidden legacy); target the visible one.
  await introPage(page).locator('#gcp:not([hidden]) .card-footer').click();
}

test('ServerCreate.GCP: user can create a new server in an existing project', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox();
  const gcp = new FakeGcp(shadowbox);
  gcp.seedBillingAccount();
  gcp.seedHealthyProject();
  await shadowbox.install(page);
  await gcp.install(page);
  await loadApp(page);

  await connectGcp(page);

  // The project is healthy, so the flow lands directly on the zone picker.
  const createServerApp = appRoot(page).locator('#gcpCreateServer');
  const regionPicker = createServerApp.locator('#regionPicker');
  await expect(regionPicker.locator('label.city-button').first()).toBeVisible();
  await regionPicker.locator('label.city-button').first().click();
  await regionPicker.locator('#createServerButton').click();

  // The guest-attribute install completes after one 5s poll cycle; the
  // progress view is shown meanwhile.
  await expect(serverView(page)).toContainText(
    englishMessage('setup-do-title'),
    {timeout: 15000}
  );
  await expect(accessKeyRows(page)).toHaveCount(1, {timeout: 20000});
  expect(gcp.instances).toHaveLength(1);
});

test('ServerCreate.GCP (first run): billing verification and project creation lead to the zone picker', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox();
  const gcp = new FakeGcp(shadowbox);
  await shadowbox.install(page);
  await gcp.install(page);
  await loadApp(page);

  // With no billing account, the flow parks on the billing setup page and
  // polls every 5s.
  await connectGcp(page);
  const createServerApp = appRoot(page).locator('#gcpCreateServer');
  await expect(createServerApp.locator('#billingAccountSetup')).toBeVisible();

  // The user sets up billing on the GCP console; the poll picks it up and
  // advances to project setup.
  gcp.seedBillingAccount();
  await expect(createServerApp.locator('#projectSetup')).toBeVisible({
    timeout: 15000,
  });

  // Create the "Outline servers" project (billing link + API enablement).
  await createServerApp.locator('#createServerButton').click();
  await expect(
    createServerApp.locator('#regionPicker label.city-button').first()
  ).toBeVisible({timeout: 20000});
  expect(gcp.projects.size).toBe(1);
});

test('ServerConnect.GCP: existing GCP servers are found after sign-in and restarts', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox({name: 'Existing GCP Server'});
  const gcp = new FakeGcp(shadowbox);
  gcp.seedBillingAccount();
  gcp.seedHealthyProject();
  gcp.seedInstalledInstance();
  await shadowbox.install(page);
  await gcp.install(page);
  await loadApp(page);

  // Signing in to an account whose project already has an Outline instance
  // must land directly on that server.
  await connectGcp(page);
  await expect(serverView(page)).toContainText('Existing GCP Server', {
    timeout: 15000,
  });

  // The account connection persists across restarts.
  await page.reload();
  await serverView(page).waitFor({timeout: 15000});
  await expect(serverView(page)).toContainText('Existing GCP Server');
});

test('ServerDestroy.GCP: user can destroy an existing GCP server', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox();
  const gcp = new FakeGcp(shadowbox);
  gcp.seedBillingAccount();
  gcp.seedHealthyProject();
  gcp.seedInstalledInstance();
  await shadowbox.install(page);
  await gcp.install(page);
  await loadApp(page);
  await connectGcp(page);
  await serverView(page).waitFor({timeout: 15000});

  await serverView(page).locator('paper-icon-button[icon="more-vert"]').click();
  await serverView(page)
    .locator('paper-item', {hasText: englishMessage('server-destroy')})
    .click();
  await appRoot(page)
    .locator('outline-modal-dialog paper-button', {
      hasText: englishMessage('destroy'),
    })
    .click();

  await expect(toast(page)).toContainText(
    englishMessage('notification-server-destroyed')
  );
  expect(gcp.instances).toHaveLength(0);

  // The instance is gone from the project: a restart must not resurrect it.
  await page.reload();
  await expect(introPage(page).locator('#gcp:not([hidden])')).toBeVisible();
});
