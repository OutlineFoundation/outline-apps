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
 * Desktop E2E suite (QA automation Layer 3, see docs/qa-automation-plan.md).
 *
 * Launches the real Electron app — main process, preload, Go backend via
 * koffi, and the real renderer — with Playwright's _electron driver. The
 * Electron client only runs on Linux and Windows; build first with
 * `npm run action client/electron/build_main linux` (plus
 * `client/go/build linux`), or run everything via
 * `npm run action client/e2e/electron/test`.
 */
export default defineConfig({
  testDir: './electron',
  outputDir: './test-results-electron',
  // One Electron instance at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', {open: 'never', outputFolder: './playwright-report-electron'}],
      ]
    : 'list',
  use: {
    trace: 'on-first-retry',
  },
});
