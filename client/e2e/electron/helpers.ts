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

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

export interface OutlineApp {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launches the built Electron app (the same unpacked entry point that
 * `npm run action client/electron/start` uses) and waits for the main
 * window's renderer to load.
 */
export async function launchOutlineApp(): Promise<OutlineApp> {
  const app = await electron.launch({
    // --no-sandbox: the Chromium SUID sandbox is unavailable on CI runners.
    args: [
      '--no-sandbox',
      path.join(REPO_ROOT, 'output', 'client', 'electron'),
    ],
    env: {...process.env, OUTLINE_DEBUG: 'true'},
  });
  // Surface the main process's own logs so a startup failure (e.g. before the
  // window is created) is diagnosable instead of a bare firstWindow timeout.
  app.process().stdout?.on('data', d => process.stdout.write(`[app] ${d}`));
  app.process().stderr?.on('data', d => process.stderr.write(`[app] ${d}`));
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {app, page};
}

/**
 * Clears the renderer's persisted state (servers, settings, privacy
 * acknowledgement) and reloads, so a test starts from a true first launch.
 */
export async function resetToFirstLaunch(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Quits the app the way the tray "Quit" entry does. The main window close
 * button intentionally hides the window instead of quitting, so tests must
 * quit via app.quit() and then wait for the process to exit.
 */
export async function quitOutlineApp(app: ElectronApplication): Promise<void> {
  const exited = new Promise<void>(resolve => {
    app.process().once('exit', () => resolve());
  });
  await app.evaluate(({app: electronApp}) => electronApp.quit());
  await exited;
}
