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

import {defineConfig} from '@playwright/test';

/**
 * Manager Electron E2E suite (QA automation Layer 3, see
 * docs/manager-qa-automation-plan.md).
 *
 * Launches the built Electron app from inside the tests, so unlike the
 * browser suite (playwright.config.ts) there is no web server and no
 * browser project. Build the app first with
 * `npm run action server_manager/electron/build`, or run the whole thing
 * via `npm run action server_manager/e2e/test_electron`.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/electron.spec.ts',
  outputDir: './test-results',
  // Each test launches its own app instance; keep them sequential to avoid
  // saturating CI runners with parallel Electron instances.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', {open: 'never', outputFolder: './playwright-report'}]]
    : 'list',
  use: {
    trace: 'on-first-retry',
  },
});
