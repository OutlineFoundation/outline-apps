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

import {execSync} from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

import type {Page, Route} from '@playwright/test';

/**
 * A fake Shadowbox management API.
 *
 * Manual servers added without a certificate fingerprint use plain
 * `window.fetch` (see server_manager/www/fetcher.ts), so impersonating the
 * API URL lets the whole app — repository, storage and UI — run real code
 * against a scriptable server. The endpoint surface mirrors what
 * ShadowboxServer (server_manager/www/shadowbox_server.ts) calls.
 *
 * Two ways to mount it:
 *
 * - `install(page)` — Playwright route interception, for the browser suite.
 *   The URL must be `https:` to satisfy the page's CSP; interception
 *   happens before any network access, so the host never resolves.
 * - `serve()` — a real local HTTPS server with a self-signed certificate,
 *   for the Electron suite: responses fulfilled through CDP reach that
 *   app's renderer with `status: 0` (its pages live on the custom
 *   `outline://` scheme), so the requests have to hit a real socket. Launch
 *   the app with `--ignore-certificate-errors`.
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

interface ApiResponse {
  status: number;
  /** JSON-encoded body; empty responses omit it. */
  body?: string;
}

// Every response carries CORS headers: in Electron the app's origin is
// outline://web_app and the renderer enforces CORS on the management API
// responses (the browser harness bypasses CORS for intercepted requests).
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export class FakeShadowbox {
  private _apiUrl: string;
  private name: string;
  private readonly version: string;
  private metricsEnabled = false;
  private readonly keys: FakeAccessKey[] = [];
  private nextKeyId = 0;
  private readonly bytesTransferredByKeyId: {[keyId: string]: number};
  private server?: https.Server;

  constructor(options: FakeShadowboxOptions = {}) {
    // `.invalid` (RFC 2606) can never resolve, so a routing mistake fails
    // fast instead of hitting a real host.
    this._apiUrl =
      options.apiUrl ?? 'https://fake-shadowbox.invalid/TestApiKey';
    this.name = options.name ?? 'Fake Shadowbox';
    this.version = options.version ?? '1.6.0';
    this.bytesTransferredByKeyId = options.bytesTransferredByKeyId ?? {};
    // A freshly installed Shadowbox always has one key (created by
    // install_server.sh's create_first_user).
    this.createKey();
  }

  get apiUrl(): string {
    return this._apiUrl;
  }

  /** The value to paste into the manual server entry screen. */
  get config(): string {
    return JSON.stringify({apiUrl: this._apiUrl});
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
    await page.route(`${this._apiUrl}/**`, route => this.handleRoute(route));
  }

  /**
   * Starts a real local HTTPS server (self-signed certificate) and points
   * this fake's API URL at it. Callers must `stop()` when done.
   */
  async serve(): Promise<void> {
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-shadowbox-'));
    const keyFile = path.join(certDir, 'key.pem');
    const certFile = path.join(certDir, 'cert.pem');
    execSync(
      "openssl req -x509 -nodes -days 1 -newkey rsa:2048 -subj '/CN=localhost' " +
        `-keyout "${keyFile}" -out "${certFile}" 2> /dev/null`
    );
    this.server = https.createServer(
      {key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile)},
      (request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
          const requestPath = new URL(request.url ?? '/', this._apiUrl).pathname
            .substring(new URL(this._apiUrl).pathname.length)
            .replace(/^\//, '');
          const {status, body} = this.handleApi(
            request.method ?? 'GET',
            requestPath,
            Buffer.concat(chunks).toString() || null
          );
          response.writeHead(status, {
            ...CORS_HEADERS,
            ...(body ? {'content-type': 'application/json'} : {}),
          });
          response.end(body ?? '');
        });
      }
    );
    await new Promise<void>(resolve =>
      this.server.listen(0, '127.0.0.1', resolve)
    );
    const address = this.server.address();
    if (typeof address === 'string' || !address) {
      throw new Error('unexpected server address');
    }
    this._apiUrl = `https://127.0.0.1:${address.port}/TestApiKey`;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>(resolve => this.server.close(() => resolve()));
      this.server = undefined;
    }
  }

  private handleRoute(route: Route): Promise<void> {
    const request = route.request();
    const requestPath = new URL(request.url()).pathname
      .substring(new URL(this._apiUrl).pathname.length)
      .replace(/^\//, '');
    const {status, body} = this.handleApi(
      request.method(),
      requestPath,
      request.postData()
    );
    return route.fulfill({
      status,
      body: body ?? '',
      headers: {
        ...CORS_HEADERS,
        ...(body ? {'content-type': 'application/json'} : {}),
      },
    });
  }

  /** Transport-agnostic core: relative path in, status/JSON body out. */
  private handleApi(
    method: string,
    path: string,
    postData: string | null
  ): ApiResponse {
    const json = (body: unknown, status = 200): ApiResponse => ({
      status,
      body: JSON.stringify(body),
    });
    const noContent = (): ApiResponse => ({status: 204});

    if (method === 'OPTIONS') {
      // CORS preflight.
      return noContent();
    }
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
      this.name = JSON.parse(postData ?? '{}').name;
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
      key.name = new URLSearchParams(postData ?? '').get('name');
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
      this.metricsEnabled = JSON.parse(postData ?? '{}').metricsEnabled;
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
