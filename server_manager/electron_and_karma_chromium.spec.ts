// Copyright 2021 The Outline Authors
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

import {version as electronVersion} from 'electron/package.json';
import {electronToChromium} from 'electron-to-chromium';
// Since we aren't in the electron process, process.versions.electron isn't defined.
// TODO(update-to-esm): we can only use node-fetch@2 now because the latest node-fetch requires ESM
import fetch from 'node-fetch';

import {config} from './package.json';

describe('Karma', () => {
  it('uses the correct Chromium version', async () => {
    // ChromiumDash is a service maintained by the Chrome team which serves metadata about current
    // and legacy Chrome versions.
    const electronChromiumVersionInfo = <
      {chromium_main_branch_position?: number}
    >await (
      await fetch(
        `https://chromiumdash.appspot.com/fetch_version?version=${electronToChromium(electronVersion)}`
      )
    ).json();
    const electronChromeRevision =
      electronChromiumVersionInfo.chromium_main_branch_position;
    expect(electronChromeRevision).toEqual(config.PUPPETEER_CHROMIUM_REVISION);
  });
});
