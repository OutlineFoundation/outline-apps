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

import '@sentry/electron/preload';
import type {HttpRequest, HttpResponse} from '@outline/infrastructure/path_api';
import {Breadcrumb} from '@sentry/electron';
import {contextBridge, ipcRenderer} from 'electron';

import * as digitalocean_oauth from './digitalocean_oauth';
import * as gcp_oauth from './gcp_oauth';
import {redactManagerUrl} from './util';

// This file is run in the renderer process *before* nodeIntegration is disabled.
//
// Use it for main/renderer process communication.

// Calling Sentry.init in preload won't work due to electron's new sandbox
// model, all renderers must call Sentry.init() by themselves.
//
// Redact PII from the renderer process requests.
// We are importing `node:url` package in `redactManagerUrl`, which is only
// available in preload or main process.
contextBridge.exposeInMainWorld(
  'redactSentryBreadcrumbUrl',
  (breadcrumb: Breadcrumb) => {
    // Redact PII from fetch requests.
    if (
      breadcrumb.category === 'fetch' &&
      breadcrumb.data &&
      breadcrumb.data.url
    ) {
      try {
        breadcrumb.data.url = `(redacted)/${redactManagerUrl(breadcrumb.data.url)}`;
      } catch {
        // NOTE: cannot log this failure to console if console breadcrumbs are enabled
        breadcrumb.data.url = '(error redacting)';
      }
    }
    return breadcrumb;
  }
);

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
