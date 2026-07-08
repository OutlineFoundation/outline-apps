// Copyright 2020 The Outline Authors
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

// The browser cannot pin certificates, so fall back to a plain fetch. This
// keeps managed (DigitalOcean/GCP) servers usable in the browser build: the
// request still fails against a real server's self-signed certificate, but
// it succeeds when the management API is reachable with valid TLS — or
// intercepted, as in the E2E suite (see server_manager/e2e).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).fetchWithPin = async (
  request: HttpRequest,
  _fingerprint: string
): Promise<HttpResponse> => {
  console.warn(
    'fetchWithPin: certificate pinning is not supported in the browser; ' +
      `fetching ${request.url} without the pin`
  );
  const response = await fetch(request.url, request);
  return {
    status: response.status,
    body: await response.text(),
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).openImage = (basename: string) => {
  window.open(`./images/${basename})`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).onUpdateDownloaded = (_callback: () => void) => {
  console.info('Requested registration of callback for update download');
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).runDigitalOceanOauth = () => {
  let isCancelled = false;
  const rejectWrapper = {reject: (_error: Error) => {}};
  const result = new Promise((resolve, reject) => {
    rejectWrapper.reject = reject;
    window.open(
      'https://cloud.digitalocean.com/account/api/tokens/new',
      'noopener,noreferrer'
    );
    const apiToken = window.prompt('Please enter your DigitalOcean API token');
    if (apiToken) {
      resolve(apiToken);
    } else {
      reject(new Error('No api token entered'));
    }
  });
  return {
    result,
    isCancelled() {
      return isCancelled;
    },
    cancel() {
      console.log('Session cancelled');
      isCancelled = true;
      rejectWrapper.reject(new Error('Authentication cancelled'));
    },
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).bringToFront = () => {
  console.info('Requested bringToFront');
};

import './main';
