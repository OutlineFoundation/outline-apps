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

// Client UI (Ui) and error reporting (Report) checklist items.
// Test titles reference the QA checklist IDs in
// docs/manager-qa-automation-plan.md.

import {test, expect} from '@playwright/test';

import {
  appRoot,
  englishMessage,
  loadApp,
  TEST_APP_VERSION,
  toast,
} from './helpers';
import spanishMessages from '../../messages/es.json';

test('Ui.I18n: user can switch to another language, and it persists', async ({
  page,
}) => {
  await loadApp(page);

  const navAbout = appRoot(page).getByTestId('nav-about');
  await expect(navAbout).toHaveText(englishMessage('nav-about'));

  await appRoot(page).locator('#language-dropdown').click();
  await appRoot(page)
    .locator('#language-dropdown paper-item', {hasText: /^\s*Español\s*$/})
    .click();

  await expect(navAbout).toHaveText(spanishMessages['nav-about']);

  // The language choice must persist across restarts.
  await page.reload();
  await expect(appRoot(page).getByTestId('nav-about')).toHaveText(
    spanishMessages['nav-about']
  );
});

// The full Ui.About accept criteria also require release builds to carry no
// "-dev" version suffix; that half can only be checked against release
// artifacts and belongs to the release-gate layer (this suite passes its own
// version to the debug browser bundle).
test('Ui.About (partial): about dialog shows the app version', async ({
  page,
}) => {
  await loadApp(page);

  await appRoot(page).getByTestId('nav-about').click();

  const aboutDialog = appRoot(page).locator('outline-about-dialog');
  await expect(aboutDialog.locator('#dialog')).toBeVisible();
  await expect(aboutDialog.locator('#version')).toContainText(TEST_APP_VERSION);
});

// The browser build initializes Sentry without a DSN, so no feedback request
// leaves the app; this asserts the UI half (form submits and confirms).
// Intercepting the actual Sentry envelope needs the @sentry/browser split
// (issue #1311) and is tracked in docs/manager-qa-automation-plan.md.
test('Report.UserFeedback (partial): user can submit feedback', async ({
  page,
}) => {
  await loadApp(page);

  await appRoot(page).getByTestId('nav-feedback').click();

  const feedbackDialog = appRoot(page).locator('outline-feedback-dialog');
  await expect(feedbackDialog.locator('#dialog')).toBeVisible();
  await feedbackDialog
    .locator('#userFeedback')
    .locator('textarea')
    .fill('E2E test feedback: please ignore.');
  await feedbackDialog.getByTestId('feedback-submit-button').click();

  await expect(toast(page)).toContainText(
    englishMessage('notification-feedback-thanks')
  );
  await expect(feedbackDialog.locator('#dialog')).not.toBeVisible();
});
