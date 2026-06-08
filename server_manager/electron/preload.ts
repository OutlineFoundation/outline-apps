// Copyright 2018 The Outline Authors
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

import type {HttpRequest, HttpResponse} from '@outline/infrastructure/path_api';
import {contextBridge, ipcRenderer} from 'electron';

import * as digitalocean_oauth from './digitalocean_oauth';
import * as gcp_oauth from './gcp_oauth';

contextBridge.exposeInMainWorld(
  'fetchWithPin',
  (request: HttpRequest, fingerprint: string): Promise<HttpResponse> =>
    ipcRenderer.invoke('fetch-with-pin', request, fingerprint)
);

contextBridge.exposeInMainWorld('openImage', (basename: string) => {
  ipcRenderer.send('open-image', basename);
});

contextBridge.exposeInMainWorld(
  'onUpdateDownloaded',
  (callback: () => void) => {
    ipcRenderer.on('update-downloaded', callback);
  }
);

contextBridge.exposeInMainWorld(
  'runDigitalOceanOauth',
  digitalocean_oauth.runOauth
);

contextBridge.exposeInMainWorld('runGcpOauth', gcp_oauth.runOauth);

contextBridge.exposeInMainWorld('bringToFront', () => {
  return ipcRenderer.send('bring-to-front');
});
