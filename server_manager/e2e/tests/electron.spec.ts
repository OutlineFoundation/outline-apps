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

// QA automation Layer 3 (see docs/manager-qa-automation-plan.md): the real
// Electron app, driven with Playwright's Electron support. Covers the app
// lifecycle half of the checklist that the browser suite cannot: the actual
// main process starts, the window opens, state survives a real app restart,
// and the app terminates gracefully.
//
// Run via `npm run action server_manager/e2e/test_electron`, which builds
// the Electron bundle and runs this file under
// electron.playwright.config.ts (the browser suite's config ignores it).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import {FakeShadowbox} from './fake_shadowbox';

const STATIC_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'output',
  'build',
  'server_manager',
  'electron',
  'static'
);

/**
 * Launches the built manager with its state routed to `userDataDir` (via
 * OUTLINE_MANAGER_USER_DATA_DIR, see server_manager/electron/index.ts), so
 * each test controls its own profile — isolated from the user's real
 * profile and any running Manager instance (the single-instance lock is
 * scoped to userData) — and "restart the app" is a real relaunch against
 * the same profile.
 */
async function launchManager(
  userDataDir: string
): Promise<{app: ElectronApplication; window: Page}> {
  const app = await electron.launch({
    // --no-sandbox: the Chromium SUID sandbox is unavailable on CI runners.
    // --ignore-certificate-errors: FakeShadowbox serves over a self-signed
    // certificate (see fake_shadowbox.ts).
    args: ['.', '--no-sandbox', '--ignore-certificate-errors'],
    cwd: STATIC_DIR,
    env: {
      ...process.env,
      OUTLINE_MANAGER_USER_DATA_DIR: userDataDir,
      // Routes the main process's console output to stderr unbuffered, so a
      // startup failure surfaces in the test output instead of a bare
      // firstWindow timeout.
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
  app
    .process()
    .stderr?.on('data', data => process.stderr.write(`[app] ${data}`));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return {app, window};
}

function makeProfileDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'outline-manager-e2e-'));
}

test('App.Start (Electron): app launches to the first-run Terms of Service', async () => {
  const {app, window} = await launchManager(makeProfileDir());
  try {
    await expect(
      window.locator('app-root').getByTestId('tos-accept-button')
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test('App.Terminate (Electron): app quits gracefully without killing the process', async () => {
  const {app} = await launchManager(makeProfileDir());
  const processExit = new Promise<number | null>(resolve =>
    app.process().once('exit', code => resolve(code))
  );
  await app.close();
  expect(await processExit).toBe(0);
});

test('ServerConnect.Manual (Electron): manual servers survive a real app restart', async () => {
  const profile = makeProfileDir();
  const shadowbox = new FakeShadowbox({name: 'Electron E2E Server'});
  // CDP-fulfilled responses reach this app's renderer with status 0 (its
  // pages live on the custom outline:// scheme), so the fake serves over a
  // real local HTTPS socket instead of Playwright routes.
  await shadowbox.serve();

  try {
    // First run: accept the TOS and add a manual server.
    {
      const {app, window} = await launchManager(profile);
      await window.locator('app-root').getByTestId('tos-accept-button').click();
      await window.locator('app-root #intro #manual-server').click();
      const manualEntry = window.locator('app-root #manualEntry');
      await manualEntry
        .locator('#serverConfig')
        .locator('textarea')
        .fill(shadowbox.config);
      await manualEntry.locator('#doneButton').click();
      await expect(
        window.locator('app-root outline-server-view').first()
      ).toContainText('Electron E2E Server');
      await app.close();
    }

    // Second run, same profile: no TOS, the server is restored from disk.
    {
      const {app, window} = await launchManager(profile);
      await expect(
        window.locator('app-root').getByTestId('tos-accept-button')
      ).not.toBeVisible();
      await expect(
        window.locator('app-root outline-server-view').first()
      ).toContainText('Electron E2E Server', {timeout: 15000});
      await app.close();
    }
  } finally {
    await shadowbox.stop();
  }
});
