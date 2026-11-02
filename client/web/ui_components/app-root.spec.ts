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

import './app-root.js';

type AppRootHarness = HTMLElement & {
  isAndroidTv: boolean;
  removeTvNavigation?: () => void;
  installTvNavigation(): void;
};

let appRoot: AppRootHarness | undefined;

function nextFrame(): Promise<void> {
  return new Promise(resolve =>
    globalThis.requestAnimationFrame(() => resolve())
  );
}

async function createAppRoot(isAndroidTv: boolean): Promise<AppRootHarness> {
  const appRoot = document.createElement(
    'app-root'
  ) as unknown as AppRootHarness;
  document.body.append(appRoot);
  await nextFrame();
  appRoot.isAndroidTv = isAndroidTv;
  await nextFrame();
  return appRoot;
}

describe('AppRoot TV navigation lifecycle', () => {
  afterEach(() => {
    appRoot?.remove();
  });

  it('does not install navigation for non-TV hosts', async () => {
    appRoot = await createAppRoot(false);

    appRoot.installTvNavigation();

    expect(appRoot.removeTvNavigation).toBeUndefined();
  });

  it('installs navigation when native detection updates the TV flag', async () => {
    appRoot = await createAppRoot(false);

    appRoot.isAndroidTv = true;
    await nextFrame();

    expect(appRoot.removeTvNavigation).toEqual(jasmine.any(Function));
  });

  it('cleans up navigation when the TV flag is cleared', async () => {
    appRoot = await createAppRoot(true);
    const removeTvNavigation = jasmine.createSpy('removeTvNavigation');
    appRoot.removeTvNavigation = removeTvNavigation;

    appRoot.isAndroidTv = false;
    await nextFrame();

    expect(removeTvNavigation).toHaveBeenCalled();
    expect(appRoot.removeTvNavigation).toBeUndefined();
  });

  it('cleans up navigation when the root disconnects', async () => {
    appRoot = await createAppRoot(true);
    expect(appRoot.removeTvNavigation).toEqual(jasmine.any(Function));

    appRoot.remove();

    expect(appRoot.removeTvNavigation).toBeUndefined();
  });
});
