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

import type {Page, Route} from '@playwright/test';

/**
 * A fake Shadowbox management API, mounted into the page with
 * `page.route()`.
 *
 * Manual servers added without a certificate fingerprint use plain
 * `window.fetch` (see server_manager/www/fetcher.ts), so intercepting
 * requests to the API URL lets the whole app — repository, storage and UI —
 * run real code against a scriptable server. The URL must be `https:` to
 * satisfy the page's CSP; the interception happens before any network
 * access, so the host never needs to resolve.
 *
 * The endpoint surface mirrors what ShadowboxServer
 * (server_manager/www/shadowbox_server.ts) calls.
 */

export interface FakeAccessKey {
  id: string;
  name: string;
  accessUrl: string;
}

interface FakeShadowboxOptions {
  apiUrl?: string;
  name?: string;
  version?: string;
  /** Data usage reported by /metrics/transfer, keyed by access key id. */
  bytesTransferredByKeyId?: {[keyId: string]: number};
}

export class FakeShadowbox {
  readonly apiUrl: string;
  private name: string;
  private readonly version: string;
  private metricsEnabled = false;
  private readonly keys: FakeAccessKey[] = [];
  private nextKeyId = 0;
  private readonly bytesTransferredByKeyId: {[keyId: string]: number};

  constructor(options: FakeShadowboxOptions = {}) {
    // `.invalid` (RFC 2606) can never resolve, so a routing mistake fails
    // fast instead of hitting a real host.
    this.apiUrl = options.apiUrl ?? 'https://fake-shadowbox.invalid/TestApiKey';
    this.name = options.name ?? 'Fake Shadowbox';
    this.version = options.version ?? '1.6.0';
    this.bytesTransferredByKeyId = options.bytesTransferredByKeyId ?? {};
    // A freshly installed Shadowbox always has one key.
    this.createKey();
  }

  /** The value to paste into the manual server entry screen. */
  get config(): string {
    return JSON.stringify({apiUrl: this.apiUrl});
  }

  listKeys(): readonly FakeAccessKey[] {
    return this.keys;
  }

  private createKey(): FakeAccessKey {
    const id = String(this.nextKeyId++);
    const key = {
      id,
      name: '',
      accessUrl: `ss://fake-secret-${id}@203.0.113.10:9999/?outline=1`,
    };
    this.keys.push(key);
    return key;
  }

  /** Starts intercepting this fake's API URL on `page`. */
  async install(page: Page): Promise<void> {
    await page.route(`${this.apiUrl}/**`, route => this.handle(route));
  }

  private handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    // Path relative to the base API URL, e.g. 'access-keys/3/name'.
    const path = url.pathname
      .substring(new URL(this.apiUrl).pathname.length)
      .replace(/^\//, '');
    const method = request.method();

    const json = (body: unknown, status = 200) =>
      route.fulfill({status, json: body});
    const noContent = () => route.fulfill({status: 204, body: ''});

    if (path === 'server' && method === 'GET') {
      return json({
        name: this.name,
        metricsEnabled: this.metricsEnabled,
        serverId: 'fake-server-id',
        createdTimestampMs: 1704067200000, // 2024-01-01T00:00:00Z
        portForNewAccessKeys: 9999,
        hostnameForAccessKeys: 'fake-shadowbox.invalid',
        version: this.version,
      });
    }
    if (path === 'name' && method === 'PUT') {
      this.name = request.postDataJSON().name;
      return noContent();
    }
    if (path === 'access-keys' && method === 'GET') {
      return json({accessKeys: this.keys});
    }
    if (path === 'access-keys' && method === 'POST') {
      return json(this.createKey(), 201);
    }
    const keyNameMatch = path.match(/^access-keys\/([^/]+)\/name$/);
    if (keyNameMatch && method === 'PUT') {
      const key = this.keys.find(k => k.id === keyNameMatch[1]);
      if (!key) {
        return json({message: 'not found'}, 404);
      }
      key.name = new URLSearchParams(request.postData() ?? '').get('name');
      return noContent();
    }
    const keyMatch = path.match(/^access-keys\/([^/]+)$/);
    if (keyMatch && method === 'DELETE') {
      const index = this.keys.findIndex(k => k.id === keyMatch[1]);
      if (index < 0) {
        return json({message: 'not found'}, 404);
      }
      this.keys.splice(index, 1);
      return noContent();
    }
    if (path === 'metrics/transfer' && method === 'GET') {
      return json({bytesTransferredByUserId: this.bytesTransferredByKeyId});
    }
    if (path.startsWith('experimental/server/metrics')) {
      // Not supported by this fake: the app falls back to /metrics/transfer.
      return json({message: 'not found'}, 404);
    }
    if (path === 'metrics/enabled' && method === 'PUT') {
      this.metricsEnabled = request.postDataJSON().metricsEnabled;
      return noContent();
    }
    if (path === 'server/hostname-for-access-keys' && method === 'PUT') {
      return noContent();
    }
    if (path === 'server/port-for-new-access-keys' && method === 'PUT') {
      return noContent();
    }
    console.warn(`FakeShadowbox: unhandled request ${method} ${path}`);
    return json({message: `unhandled: ${method} ${path}`}, 404);
  }
}
