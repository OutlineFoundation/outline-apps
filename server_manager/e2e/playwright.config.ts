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

import * as path from 'path';

import {defineConfig, devices} from '@playwright/test';

const WWW_DIR = path.join(
  __dirname,
  '..',
  '..',
  'output',
  'build',
  'server_manager',
  'www',
  'static'
);

/**
 * Manager UI E2E suite (QA automation Layer 1, see
 * docs/manager-qa-automation-plan.md).
 *
 * Drives the browser build of the Manager: the real web UI running against
 * a route-intercepted fake of the Shadowbox management API. Build the bundle
 * first (`npx webpack --config=server_manager/browser.webpack.js`), or run
 * the whole thing via `npm run action server_manager/e2e/test`.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', {open: 'never', outputFolder: './playwright-report'}]]
    : 'list',
  use: {
    baseURL: 'http://localhost:18624',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx http-server "${WWW_DIR}" --port 18624 --silent -c-1`,
    url: 'http://localhost:18624',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
});
