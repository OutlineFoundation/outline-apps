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
 * Desktop real-tunnel E2E suite (QA automation Layer 3, nightly tier; see
 * docs/qa-automation-plan.md).
 *
 * Launches the real Electron app and establishes a real VPN — TUN device,
 * NetworkManager routing, Go backend — against a hermetic Shadowsocks server
 * in an isolated network namespace. Requires root and the environment set up
 * by client/e2e/electron/tunnel/setup_netns.sh; run everything via
 * `sudo -E env "PATH=$PATH" xvfb-run --auto-servernum -- npm run action
 * client/e2e/electron/test_tunnel`.
 */
export default defineConfig({
  testDir: './electron',
  testMatch: 'tunnel.spec.ts',
  outputDir: './test-results-electron-tunnel',
  // One Electron instance (and one system-wide VPN) at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A retry mutates global VPN/routing state, so allow only one and keep the
  // trace from the failed attempt.
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  reporter: process.env.CI
    ? [
        ['list'],
        [
          'html',
          {open: 'never', outputFolder: './playwright-report-electron-tunnel'},
        ],
      ]
    : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
