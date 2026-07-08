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

// DigitalOcean checklist items (ServerCreate/ServerConnect/ServerDestroy
// .DigitalOcean), against a route-intercepted DigitalOcean REST API. The
// browser build's OAuth stub asks for the API token via window.prompt, which
// the tests answer through Playwright's dialog handler — everything after
// that runs the app's real DigitalOcean code over the intercepted API.
// Test titles reference the QA checklist IDs in
// docs/manager-qa-automation-plan.md.

import {test, expect, type Page} from '@playwright/test';

import {FakeDigitalOcean} from './fake_digitalocean';
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

/** Clicks the DigitalOcean intro card and answers the token prompt. */
async function connectDigitalOcean(page: Page): Promise<void> {
  page.once('dialog', dialog => void dialog.accept('fake-do-token'));
  await introPage(page).locator('#digital-ocean').click();
}

test('ServerCreate.DigitalOcean: user can create a new server through DigitalOcean', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox();
  const digitalOcean = new FakeDigitalOcean(shadowbox);
  await shadowbox.install(page);
  await digitalOcean.install(page);
  await loadApp(page);

  await connectDigitalOcean(page);

  // Region picker: pick the first available city and create.
  const regionPicker = appRoot(page).locator('#regionPicker');
  await expect(regionPicker.locator('label.city-button').first()).toBeVisible();
  await regionPicker.locator('label.city-button').first().click();
  await regionPicker.locator('#createServerButton').click();

  // While the fake droplet "installs" (~one 3s poll cycle), the progress
  // view is shown.
  await expect(serverView(page)).toContainText(
    englishMessage('setup-do-title'),
    {timeout: 15000}
  );

  // The server view must reach the management view with the new server:
  // droplet created, install tags discovered, management API reachable.
  await expect(serverView(page)).toContainText(
    englishMessage('server-name', {serverLocation: 'Amsterdam'}),
    {timeout: 15000}
  );
  await expect(accessKeyRows(page)).toHaveCount(1);
  expect(digitalOcean.droplets).toHaveLength(1);
});

test('ServerConnect.DigitalOcean: existing DigitalOcean servers are found after sign-in and restarts', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox({name: 'Existing DO Server'});
  const digitalOcean = new FakeDigitalOcean(shadowbox);
  digitalOcean.seedInstalledDroplet();
  await shadowbox.install(page);
  await digitalOcean.install(page);
  await loadApp(page);

  // Signing in to an account that already has an Outline droplet must land
  // directly on that server, not the creation flow.
  await connectDigitalOcean(page);
  await expect(serverView(page)).toContainText('Existing DO Server');

  // The account connection persists across restarts: no new sign-in prompt,
  // the server list is rediscovered from the API.
  await page.reload();
  await serverView(page).waitFor();
  await expect(serverView(page)).toContainText('Existing DO Server');
});

test('ServerDestroy.DigitalOcean: user can destroy an existing DigitalOcean server', async ({
  page,
}) => {
  const shadowbox = new FakeShadowbox();
  const digitalOcean = new FakeDigitalOcean(shadowbox);
  digitalOcean.seedInstalledDroplet();
  await shadowbox.install(page);
  await digitalOcean.install(page);
  await loadApp(page);
  await connectDigitalOcean(page);
  await serverView(page).waitFor();

  // The overflow menu next to the server name offers "Destroy server" for
  // managed servers.
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
  expect(digitalOcean.droplets).toHaveLength(0);

  // The droplet is gone from the account: a restart must not resurrect it.
  await page.reload();
  await expect(introPage(page).locator('#digital-ocean')).toBeVisible();
});
