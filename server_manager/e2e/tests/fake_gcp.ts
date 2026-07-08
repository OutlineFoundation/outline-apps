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
 * A fake of the GCP API surface the manager uses, mounted into the page with
 * `page.route()`.
 *
 * The manager drives GCP entirely from the renderer over `fetch` (see
 * server_manager/cloud/gcp_api.ts), across six hosts: the OAuth token
 * endpoint, OpenID userinfo, Compute Engine, Resource Manager, Service Usage
 * and Cloud Billing. A created instance completes its "install" through the
 * guest-attributes poll (`outline/` namespace): one poll of
 * `install-started`, then `apiUrl`/`certSha256` pointing at the
 * FakeShadowbox passed to the constructor (see
 * server_manager/www/gcp_server.ts; polls are 5s apart, so creation takes
 * one cycle, keeping the progress view visible long enough to avoid the
 * stuck-progress race an instant install would cause).
 */

const COMPUTE_BASE = 'https://compute.googleapis.com/compute/v1';

interface FakeInstance {
  id: string;
  name: string;
  description: string;
  zoneId: string;
  natIP: string;
  /** Guest-attribute polls left before the install attributes appear. */
  pollsUntilInstalled: number;
}

export class FakeGcp {
  readonly instances: FakeInstance[] = [];
  /** Project IDs known to the account, mapped to "healthy" state. */
  readonly projects = new Map<
    string,
    {billingEnabled: boolean; computeEnabled: boolean}
  >();
  private billingAccounts: {displayName: string}[] = [];
  private hasFirewall = false;
  private readonly staticIps = new Set<string>();
  private nextId = 5000;

  constructor(private readonly shadowbox: FakeShadowbox) {}

  /** Starts intercepting the GCP APIs on `page`. */
  async install(page: Page): Promise<void> {
    const hosts = [
      'https://oauth2.googleapis.com/**',
      'https://openidconnect.googleapis.com/**',
      'https://compute.googleapis.com/**',
      'https://cloudresourcemanager.googleapis.com/**',
      'https://serviceusage.googleapis.com/**',
      'https://cloudbilling.googleapis.com/**',
    ];
    for (const host of hosts) {
      await page.route(host, route => this.handle(route));
    }
  }

  /** Simulates an account with an open billing account. */
  seedBillingAccount(displayName = 'E2E Billing Account'): void {
    this.billingAccounts.push({displayName});
  }

  /** Simulates a fully set-up "Outline servers" project. */
  seedHealthyProject(projectId = 'outline-e2e-project'): void {
    this.projects.set(projectId, {billingEnabled: true, computeEnabled: true});
  }

  /** Simulates an existing, fully installed server in the project. */
  seedInstalledInstance(zoneId = 'us-central1-a'): void {
    const instance = this.makeInstance('Existing GCP Server', zoneId);
    instance.pollsUntilInstalled = 0;
    this.instances.push(instance);
  }

  private makeInstance(description: string, zoneId: string): FakeInstance {
    return {
      id: String(this.nextId++),
      name: `outline-e2e-${this.nextId}`,
      description,
      zoneId,
      natIP: '203.0.113.55',
      pollsUntilInstalled: 1,
    };
  }

  private instanceJson(projectId: string, instance: FakeInstance) {
    return {
      id: instance.id,
      name: instance.name,
      description: instance.description,
      zone: `${COMPUTE_BASE}/projects/${projectId}/zones/${instance.zoneId}`,
      labels: {outline: 'true'},
      networkInterfaces: [{accessConfigs: [{natIP: instance.natIP}]}],
    };
  }

  private computeOperation(targetId = '') {
    return {
      id: String(this.nextId++),
      name: `operation-${this.nextId}`,
      targetId,
      status: 'DONE',
    };
  }

  private handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({status, json: body});

    // OAuth: refresh token -> access token.
    if (url.hostname === 'oauth2.googleapis.com') {
      return json({access_token: 'fake-gcp-access-token', expires_in: 3600});
    }
    if (url.hostname === 'openidconnect.googleapis.com') {
      return json({email: 'e2e-gcp@example.com'});
    }
    if (url.hostname === 'cloudbilling.googleapis.com') {
      return this.handleBilling(url, method, json);
    }
    if (url.hostname === 'cloudresourcemanager.googleapis.com') {
      return this.handleResourceManager(
        url,
        method,
        request.postDataJSON.bind(request),
        json
      );
    }
    if (url.hostname === 'serviceusage.googleapis.com') {
      return this.handleServiceUsage(url, method, json);
    }
    if (url.hostname === 'compute.googleapis.com') {
      return this.handleCompute(
        url,
        method,
        request.postDataJSON.bind(request),
        json
      );
    }
    console.warn(`FakeGcp: unhandled host ${url.hostname}`);
    return json({error: {message: `unhandled: ${url.hostname}`}}, 404);
  }

  private handleBilling(
    url: URL,
    method: string,
    json: (body: unknown, status?: number) => Promise<void>
  ): Promise<void> {
    if (url.pathname === '/v1/billingAccounts') {
      return json({
        billingAccounts: this.billingAccounts.map((account, index) => ({
          name: `billingAccounts/BILLING-${index}`,
          open: true,
          displayName: account.displayName,
        })),
      });
    }
    const billingInfoMatch = url.pathname.match(
      /^\/v1\/projects\/([^/]+)\/billingInfo$/
    );
    if (billingInfoMatch) {
      const projectId = billingInfoMatch[1];
      const project = this.projects.get(projectId);
      if (method === 'PUT') {
        if (project) {
          project.billingEnabled = true;
        }
        return json({projectId, billingEnabled: true});
      }
      return json({
        projectId,
        billingEnabled: project?.billingEnabled ?? false,
      });
    }
    console.warn(`FakeGcp: unhandled billing ${method} ${url.pathname}`);
    return json({error: {message: 'unhandled'}}, 404);
  }

  private handleResourceManager(
    url: URL,
    method: string,
    postDataJSON: () => {projectId?: string},
    json: (body: unknown, status?: number) => Promise<void>
  ): Promise<void> {
    if (url.pathname === '/v1/projects' && method === 'GET') {
      return json({
        projects: [...this.projects.keys()].map(projectId => ({
          projectId,
          name: 'Outline servers',
          lifecycleState: 'ACTIVE',
        })),
      });
    }
    if (url.pathname === '/v1/projects' && method === 'POST') {
      const projectId = postDataJSON().projectId;
      this.projects.set(projectId, {
        billingEnabled: false,
        computeEnabled: false,
      });
      return json({name: 'operations/create-project', done: false});
    }
    if (url.pathname === '/v1/operations/create-project') {
      return json({name: 'operations/create-project', done: true});
    }
    console.warn(`FakeGcp: unhandled rm ${method} ${url.pathname}`);
    return json({error: {message: 'unhandled'}}, 404);
  }

  private handleServiceUsage(
    url: URL,
    method: string,
    json: (body: unknown, status?: number) => Promise<void>
  ): Promise<void> {
    const servicesMatch = url.pathname.match(
      /^\/v1\/projects\/([^/]+)\/services(:batchEnable)?$/
    );
    if (servicesMatch && method === 'POST') {
      const project = this.projects.get(servicesMatch[1]);
      if (project) {
        project.computeEnabled = true;
      }
      return json({name: 'operations/enable-services', done: false});
    }
    if (servicesMatch && method === 'GET') {
      const project = this.projects.get(servicesMatch[1]);
      return json({
        services: project?.computeEnabled
          ? [
              {
                name: `projects/${servicesMatch[1]}/services/compute.googleapis.com`,
                config: {name: 'compute.googleapis.com'},
                state: 'ENABLED',
              },
            ]
          : [],
      });
    }
    if (url.pathname === '/v1/operations/enable-services') {
      return json({name: 'operations/enable-services', done: true});
    }
    console.warn(`FakeGcp: unhandled su ${method} ${url.pathname}`);
    return json({error: {message: 'unhandled'}}, 404);
  }

  private handleCompute(
    url: URL,
    method: string,
    postDataJSON: () => {name?: string; description?: string},
    json: (body: unknown, status?: number) => Promise<void>
  ): Promise<void> {
    const path = url.pathname.replace('/compute/v1/', '');
    const projectMatch = path.match(/^projects\/([^/]+)\/(.*)$/);
    if (!projectMatch) {
      return json({error: {message: 'bad path'}}, 404);
    }
    const [, projectId, rest] = projectMatch;

    if (rest === 'zones' && method === 'GET') {
      return json({
        items: [
          {name: 'us-central1-a', status: 'UP'},
          {name: 'europe-west1-b', status: 'UP'},
        ],
      });
    }
    if (rest === 'aggregated/instances' && method === 'GET') {
      const items: {[zone: string]: {instances: unknown[]}} = {};
      for (const instance of this.instances) {
        const zoneKey = `zones/${instance.zoneId}`;
        items[zoneKey] ??= {instances: []};
        items[zoneKey].instances.push(this.instanceJson(projectId, instance));
      }
      return json({items});
    }
    if (rest === 'global/firewalls' && method === 'GET') {
      return json({
        items: this.hasFirewall ? [{name: 'outline'}] : [],
      });
    }
    if (rest === 'global/firewalls' && method === 'POST') {
      this.hasFirewall = true;
      return json(this.computeOperation());
    }
    if (/^global\/operations\/[^/]+\/wait$/.test(rest)) {
      return json(this.computeOperation());
    }

    const zoneMatch = rest.match(/^zones\/([^/]+)\/(.*)$/);
    if (zoneMatch) {
      const [, zoneId, zoneRest] = zoneMatch;
      if (zoneRest === 'instances' && method === 'POST') {
        const body = postDataJSON();
        const instance = this.makeInstance(body.description ?? '', zoneId);
        instance.name = body.name ?? instance.name;
        this.instances.push(instance);
        return json(this.computeOperation(instance.id), 201);
      }
      if (/^operations\/[^/]+\/wait$/.test(zoneRest)) {
        return json(this.computeOperation());
      }
      const instanceMatch = zoneRest.match(
        /^instances\/([^/]+)(\/getGuestAttributes)?$/
      );
      if (instanceMatch) {
        const instance = this.instances.find(i => i.id === instanceMatch[1]);
        if (!instance) {
          return json({error: {message: 'not found'}}, 404);
        }
        if (instanceMatch[2]) {
          return json(this.guestAttributes(instance));
        }
        if (method === 'DELETE') {
          this.instances.splice(this.instances.indexOf(instance), 1);
          return json(this.computeOperation(instance.id));
        }
        return json(this.instanceJson(projectId, instance));
      }
    }

    const regionMatch = rest.match(/^regions\/([^/]+)\/(.*)$/);
    if (regionMatch) {
      const [, , regionRest] = regionMatch;
      if (regionRest === 'addresses' && method === 'POST') {
        this.staticIps.add(postDataJSON().name);
        return json(this.computeOperation());
      }
      if (/^operations\/[^/]+\/wait$/.test(regionRest)) {
        return json(this.computeOperation());
      }
      const addressMatch = regionRest.match(/^addresses\/([^/]+)$/);
      if (addressMatch && method === 'DELETE') {
        this.staticIps.delete(addressMatch[1]);
        return json(this.computeOperation());
      }
      if (addressMatch) {
        return this.staticIps.has(addressMatch[1])
          ? json({name: addressMatch[1]})
          : json({error: {message: 'not found'}}, 404);
      }
    }

    console.warn(`FakeGcp: unhandled compute ${method} ${path}`);
    return json({error: {message: `unhandled: ${method} ${path}`}}, 404);
  }

  private guestAttributes(instance: FakeInstance) {
    if (instance.pollsUntilInstalled > 0) {
      instance.pollsUntilInstalled--;
      return {
        queryPath: 'outline/',
        queryValue: {
          items: [
            {namespace: 'outline', key: 'install-started', value: 'true'},
          ],
        },
      };
    }
    return {
      queryPath: 'outline/',
      queryValue: {
        items: [
          {namespace: 'outline', key: 'apiUrl', value: this.shadowbox.apiUrl},
          {
            namespace: 'outline',
            key: 'certSha256',
            // GcpServer passes atob(certSha256) as the pin; the browser
            // build's fetchWithPin ignores it.
            value: btoa('fake-certificate-fingerprint-32b!'),
          },
        ],
      },
    };
  }
}
