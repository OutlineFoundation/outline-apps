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

import type {FakeShadowbox} from './fake_shadowbox';
import englishMessages from '../../messages/en.json';

/** The version reported by the app under test (see `loadApp`). */
export const TEST_APP_VERSION = '0.0.0-e2e';

/**
 * Returns the app's own English message for the given key, so toast/text
 * assertions track wording changes instead of hardcoding strings. Supports
 * simple ICU-style `{placeholder}` substitution.
 */
export function englishMessage(
  key: keyof typeof englishMessages,
  substitutions: Record<string, string> = {}
): string {
  let message: string = englishMessages[key];
  for (const [name, value] of Object.entries(substitutions)) {
    message = message.replace(`{${name}}`, value);
  }
  return message;
}

/**
 * Loads the app with a clean localStorage.
 *
 * Unless `firstLaunch` is set, the terms-of-service acknowledgement and the
 * per-server metrics opt-in prompt (a modal that would otherwise cover the
 * server view) are pre-dismissed so tests can go straight to the behavior
 * under test.
 */
export async function loadApp(
  page: Page,
  {firstLaunch = false}: {firstLaunch?: boolean} = {}
): Promise<void> {
  if (!firstLaunch) {
    await page.addInitScript(() => {
      if (!window.localStorage.getItem('tos-ack')) {
        window.localStorage.setItem('tos-ack', String(Date.now()));
      }
      // Key format: `${serverId}-prompted-for-metrics` (see
      // App.showMetricsOptInWhenNeeded); FakeShadowbox always reports
      // serverId 'fake-server-id'.
      window.localStorage.setItem(
        'fake-server-id-prompted-for-metrics',
        'true'
      );
    });
  }
  await page.goto(`/?version=${TEST_APP_VERSION}`);
}

/** The `app-root` element (everything else lives in its shadow DOM). */
export function appRoot(page: Page) {
  return page.locator('app-root');
}

/** The intro page's provider cards ("choose a cloud provider" screen). */
export function introPage(page: Page) {
  return appRoot(page).locator('#intro');
}

/** The server management view for the currently selected server. */
export function serverView(page: Page) {
  return appRoot(page).locator('outline-server-view');
}

/**
 * Adds `fake` as a manual server through the real UI flow: intro →
 * "set up on your own server" → paste config → done.
 *
 * The fake must already be installed on the page (`fake.install(page)`).
 */
export async function addManualServer(
  page: Page,
  fake: FakeShadowbox
): Promise<void> {
  await introPage(page).locator('#manual-server').click();
  const manualEntry = appRoot(page).locator('#manualEntry');
  await manualEntry
    .locator('#serverConfig')
    .locator('textarea')
    .fill(fake.config);
  await manualEntry.locator('#doneButton').click();
  await serverView(page).waitFor();
}

/** Rows of the access key table in the server view. */
export function accessKeyRows(page: Page) {
  return serverView(page).locator('access-key-data-table tbody tr');
}

/** Asserts against the app's toast element. */
export function toast(page: Page) {
  return appRoot(page).locator('#toast');
}
