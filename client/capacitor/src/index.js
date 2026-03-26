/**
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// TODO(M3): Need to merge dependencies with parent package.json.

/* eslint-env browser */
// This entrypoint is bundled for Capacitor and resolved in that environment.
// eslint-disable-next-line n/no-extraneous-import,n/no-missing-import
import {Device} from '@capacitor/device';

async function getDeviceInfo() {
  const info = await Device.getInfo();
  return info;
}

window.onload = start;
function start() {
  getDeviceInfo().then(info => {
    document.body.innerHTML = JSON.stringify(info, null, 4);
  });
}
