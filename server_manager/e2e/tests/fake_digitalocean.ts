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

import type {FakeShadowbox} from './fake_shadowbox';

/**
 * A fake DigitalOcean REST API (`api.digitalocean.com/v2`), mounted into the
 * page with `page.route()`.
 *
 * The manager drives DigitalOcean entirely from the renderer over XHR (see
 * server_manager/cloud/digitalocean_api.ts), so intercepting that origin
 * covers account status, region listing, droplet creation/polling and
 * destruction. A created droplet immediately "finishes installing": its
 * droplet info carries the `kv:apiurl:<hex>` and `kv:certsha256:<hex>` tags
 * (see server_manager/www/digitalocean_server.ts) pointing at the
 * FakeShadowbox passed to the constructor, whose management API serves the
 * server view from then on.
 */

const SHADOWBOX_TAG = 'shadowbox';
// Decodes to a 32-byte fake certificate fingerprint. The browser build
// cannot pin certificates (window.fetchWithPin falls back to plain fetch),
// so the value only needs to be present and well-formed hex.
const FAKE_CERT_SHA256_HEX = 'ab'.repeat(32);

function hexEncode(text: string): string {
  return [...text]
    .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

interface FakeDroplet {
  id: number;
  name: string;
  status: 'new' | 'active';
  tags: string[];
  region: {slug: string};
  size: {transfer: number; price_monthly: number};
  networks: {v4: {type: string; ip_address: string}[]};
  /** Droplet polls left before the install tags appear. */
  pollsUntilInstalled: number;
}

export class FakeDigitalOcean {
  readonly droplets: FakeDroplet[] = [];
  private nextDropletId = 1000;

  constructor(private readonly shadowbox: FakeShadowbox) {}

  private installTags(): string[] {
    return [
      `kv:apiurl:${hexEncode(this.shadowbox.apiUrl)}`,
      `kv:certsha256:${FAKE_CERT_SHA256_HEX}`,
    ];
  }

  /** Starts intercepting the DigitalOcean API on `page`. */
  async install(page: Page): Promise<void> {
    await page.route('https://api.digitalocean.com/v2/**', route =>
      this.handle(route)
    );
    // The browser build's OAuth stub opens the DigitalOcean token page in a
    // popup before prompting for the token; keep that popup from hitting the
    // network.
    await page
      .context()
      .route('https://cloud.digitalocean.com/**', route => route.abort());
  }

  /** Simulates an existing, fully installed server on the account. */
  seedInstalledDroplet(region = 'ams3'): void {
    const droplet = this.makeDroplet('Existing Server', region, 'active');
    droplet.pollsUntilInstalled = 0;
    droplet.tags.push(...this.installTags());
    this.droplets.push(droplet);
  }

  private makeDroplet(
    name: string,
    region: string,
    status: 'new' | 'active'
  ): FakeDroplet {
    return {
      id: this.nextDropletId++,
      name,
      status,
      tags: [SHADOWBOX_TAG],
      region: {slug: region},
      size: {transfer: 1, price_monthly: 5},
      networks: {v4: [{type: 'public', ip_address: '203.0.113.99'}]},
      // A real install takes ~90s of droplet polling. Withhold the install
      // tags for one poll cycle so the app's progress view has time to
      // appear before installation "completes" — with 0, installation can
      // finish before the view is stamped, which leaves the progress view
      // on screen forever (the polls are 3s apart, so 1 ≈ 3 seconds).
      pollsUntilInstalled: 1,
    };
  }

  private handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v2\//, '');
    const method = request.method();

    const json = (body: unknown, status = 200) =>
      route.fulfill({status, json: body});

    if (path === 'account' && method === 'GET') {
      return json({
        account: {
          droplet_limit: 25,
          email: 'e2e-test@example.com',
          uuid: 'fake-do-account-uuid',
          email_verified: true,
          status: 'active',
          status_message: '',
        },
      });
    }
    if (path === 'account/keys' && method === 'POST') {
      return json({ssh_key: {id: 1}}, 201);
    }
    if (path === 'regions' && method === 'GET') {
      return json({
        regions: [
          {
            slug: 'ams3',
            name: 'Amsterdam 3',
            sizes: ['s-1vcpu-1gb'],
            available: true,
            features: [],
          },
          {
            slug: 'nyc1',
            name: 'New York 1',
            sizes: ['s-1vcpu-1gb'],
            available: true,
            features: [],
          },
        ],
      });
    }
    if (path === 'droplets' && method === 'GET') {
      const tag = url.searchParams.get('tag_name');
      const droplets = tag
        ? this.droplets.filter(droplet => droplet.tags.includes(tag))
        : this.droplets;
      return json({droplets});
    }
    if (path === 'droplets' && method === 'POST') {
      const spec = request.postDataJSON();
      // Fresh droplets report status 'new'; the app's first poll (an
      // immediate GET) sees them 'active' with the install tags.
      const droplet = this.makeDroplet(spec.name, spec.region, 'new');
      this.droplets.push(droplet);
      return json({droplet}, 202);
    }
    const dropletMatch = path.match(/^droplets\/(\d+)$/);
    if (dropletMatch && method === 'GET') {
      const droplet = this.droplets.find(d => d.id === Number(dropletMatch[1]));
      if (!droplet) {
        return json({id: 'not_found', message: 'not found'}, 404);
      }
      droplet.status = 'active';
      if (droplet.pollsUntilInstalled > 0) {
        droplet.pollsUntilInstalled--;
      } else if (!droplet.tags.some(tag => tag.startsWith('kv:apiurl:'))) {
        droplet.tags.push(...this.installTags());
      }
      return json({droplet});
    }
    if (dropletMatch && method === 'DELETE') {
      const index = this.droplets.findIndex(
        d => d.id === Number(dropletMatch[1])
      );
      if (index < 0) {
        return json({id: 'not_found', message: 'not found'}, 404);
      }
      this.droplets.splice(index, 1);
      return route.fulfill({status: 204, body: ''});
    }
    console.warn(`FakeDigitalOcean: unhandled request ${method} ${path}`);
    return json(
      {id: 'not_handled', message: `unhandled: ${method} ${path}`},
      404
    );
  }
}
