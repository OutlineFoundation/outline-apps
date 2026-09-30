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

import './ui_components/app-root';

import {App, LAST_DISPLAYED_SERVER_STORAGE_KEY} from './app';
import {
  FakeCloudAccounts,
  FakeDigitalOceanAccount,
  FakeManualServerRepository,
  FakeManualServer,
} from './testing/models';
import {AppRoot} from './ui_components/app-root';
import * as accounts from '../model/accounts';
import {Region} from '../model/digitalocean';
import * as server from '../model/server';

// Define functions from preload.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).onUpdateDownloaded = () => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).bringToFront = () => {};

// Inject app-root element into DOM once before each test.
beforeEach(() => {
  document.body.innerHTML = "<app-root id='appRoot' language='en'></app-root>";
});

describe('App', () => {
  it('shows intro when starting with no manual servers or DigitalOcean token', async () => {
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const app = createTestApp(appRoot);
    await app.start();
    expect(appRoot.currentPage).toEqual('intro');
  });

  it('will not create a manual server with invalid input', async () => {
    // Create a new app with no existing servers or DigitalOcean token.
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const app = createTestApp(appRoot);
    await app.start();
    expect(appRoot.currentPage).toEqual('intro');
    await expectAsync(
      app.createManualServer('bad input')
    ).toBeRejectedWithError();
  });

  it('creates a manual server with valid input', async () => {
    // Create a new app with no existing servers or DigitalOcean token.
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const app = createTestApp(appRoot);
    await app.start();
    expect(appRoot.currentPage).toEqual('intro');
    await app.createManualServer(
      JSON.stringify({certSha256: 'cert', apiUrl: 'url'})
    );
    expect(appRoot.currentPage).toEqual('serverView');
  });

  it('adds and shows a manual server without waiting for its health check', async () => {
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const manualServerRepo = new PendingHealthManualServerRepository();
    const app = createTestApp(appRoot, undefined, manualServerRepo);
    await app.start();
    const config = {certSha256: 'cert', apiUrl: 'url'};

    // Resolves even though the server's health check never completes.
    await app.createManualServer(JSON.stringify(config));

    expect(manualServerRepo.findServer(config)).toBeDefined();
    expect(appRoot.selectedServerId).toEqual(
      manualServerRepo.findServer(config).getId()
    );
    expect(appRoot.currentPage).toEqual('serverView');
    // While the check is pending, the view shows a connecting state rather
    // than an empty management view.
    await flushPromises();
    const view = await appRoot.getServerView(appRoot.selectedServerId);
    expect(view.selectedPage).toEqual('connectingView');
  });

  it('shows the connecting view again while retrying an unreachable manual server', async () => {
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const manualServerRepo = new DeferredHealthManualServerRepository();
    const app = createTestApp(appRoot, undefined, manualServerRepo);
    await app.start();
    await app.createManualServer(
      JSON.stringify({certSha256: 'cert', apiUrl: 'url'})
    );
    await flushPromises();
    const view = await appRoot.getServerView(appRoot.selectedServerId);
    const manualServer = manualServerRepo.deferredServers[0];

    manualServer.resolveHealth(false);
    await flushPromises();
    expect(view.selectedPage).toEqual('unreachableView');

    // Tap Retry the way the unreachable page does.
    const retryButton = view.shadowRoot.querySelector('.try-again-btn');
    retryButton.dispatchEvent(
      new CustomEvent('tap', {bubbles: true, composed: true})
    );
    await flushPromises();
    expect(manualServer.healthChecks).toEqual(2);
    expect(view.selectedPage).toEqual('connectingView');

    manualServer.resolveHealth(true);
    await flushPromises();
    expect(view.selectedPage).toEqual('managementView');
  });

  it('initially shows servers', async () => {
    // Create fake servers and simulate their metadata being cached before creating the app.
    const fakeAccount = new FakeDigitalOceanAccount();
    await fakeAccount.createServer(new Region('_fake-region-id'));
    const cloudAccounts = new FakeCloudAccounts(fakeAccount);

    const manualServerRepo = new FakeManualServerRepository();
    await manualServerRepo.addServer({
      certSha256: 'cert',
      apiUrl: 'fake-manual-server-api-url-1',
    });
    await manualServerRepo.addServer({
      certSha256: 'cert',
      apiUrl: 'fake-manual-server-api-url-2',
    });

    const appRoot = document.getElementById('appRoot') as AppRoot;
    expect(appRoot.serverList.length).toEqual(0);
    const app = createTestApp(appRoot, cloudAccounts, manualServerRepo);

    await app.start();
    // Validate that server metadata is shown.
    const managedServers = await fakeAccount.listServers();
    expect(managedServers.length).toEqual(1);
    const manualServers = await manualServerRepo.listServers();
    expect(manualServers.length).toEqual(2);
    await appRoot.getServerView('');
    const serverList = appRoot.serverList;

    expect(serverList.length).toEqual(
      manualServers.length + managedServers.length
    );
    expect(serverList).toContain(
      jasmine.objectContaining({id: 'fake-manual-server-api-url-1'})
    );
    expect(serverList).toContain(
      jasmine.objectContaining({id: 'fake-manual-server-api-url-2'})
    );
    expect(serverList).toContain(
      jasmine.objectContaining({id: '_fake-region-id'})
    );
  });

  it('uses the metrics endpoint by default', async () => {
    expect(
      (
        await (
          await new FakeManualServer({
            certSha256: 'cert',
            apiUrl: 'api-url',
          })
        ).getServerMetrics()
      ).accessKeys.length
    ).toBe(1);
  });

  it('uses the experimental metrics endpoint if present', async () => {
    class FakeExperimentalMetricsManualServer extends FakeManualServer {
      getSupportedExperimentalUniversalMetricsEndpoint() {
        return Promise.resolve(true);
      }
    }

    expect(
      (
        await new FakeExperimentalMetricsManualServer({
          certSha256: 'cert',
          apiUrl: 'api-url',
        }).getServerMetrics()
      ).server?.locations.length
    ).toBe(1);
  });

  it('initially shows the last selected server', async () => {
    const LAST_DISPLAYED_SERVER_ID = 'fake-manual-server-api-url-1';
    const manualServerRepo = new FakeManualServerRepository();
    const lastDisplayedServer = await manualServerRepo.addServer({
      certSha256: 'cert',
      apiUrl: LAST_DISPLAYED_SERVER_ID,
    });
    await manualServerRepo.addServer({
      certSha256: 'cert',
      apiUrl: 'fake-manual-server-api-url-2',
    });
    localStorage.setItem('lastDisplayedServer', LAST_DISPLAYED_SERVER_ID);
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const app = createTestApp(appRoot, undefined, manualServerRepo);
    await app.start();
    expect(appRoot.currentPage).toEqual('serverView');
    expect(appRoot.selectedServerId).toEqual(
      lastDisplayedServer.getManagementApiUrl()
    );
  });

  it('shows selected server and access keys', async done => {
    const SERVER_ID = 'fake-manual-server-api-url-1';
    const manualServerRepo = new FakeManualServerRepository();
    const server = await manualServerRepo.addServer({
      certSha256: 'cert',
      apiUrl: SERVER_ID,
    });
    await server.addAccessKey();

    const appRoot = document.getElementById('appRoot') as AppRoot;
    const app = createTestApp(appRoot, undefined, manualServerRepo);
    await app.start();
    await app.showServer(server);
    const view = await appRoot.getServerView(SERVER_ID);

    expect(appRoot.currentPage).toEqual('serverView');
    expect(appRoot.selectedServerId).toEqual(SERVER_ID);
    setTimeout(() => {
      expect(view.accessKeyData.length).toEqual(1);
      done();
    }, 100);
  });

  it('shows selected server and access keys for non-semantic version server', async done => {
    const SERVER_ID = 'fake-manual-server-api-url-1';
    const manualServerRepo = new FakeManualServerRepository();
    const server = await manualServerRepo.addServer({
      certSha256: 'cert',
      apiUrl: SERVER_ID,
    });
    spyOn(server, 'getVersion').and.returnValue('0.0.0');
    await server.addAccessKey();

    const appRoot = document.getElementById('appRoot') as AppRoot;
    const app = createTestApp(appRoot, undefined, manualServerRepo);
    await app.start();
    await app.showServer(server);
    const view = await appRoot.getServerView(SERVER_ID);

    expect(appRoot.currentPage).toEqual('serverView');
    expect(appRoot.selectedServerId).toEqual(SERVER_ID);
    setTimeout(() => {
      expect(view.accessKeyData.length).toEqual(1);
      done();
    }, 100);
  });

  it('shows progress screen once DigitalOcean droplets are created', async () => {
    // Start the app with a fake DigitalOcean token.
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const cloudAccounts = new FakeCloudAccounts(new FakeDigitalOceanAccount());
    const app = createTestApp(appRoot, cloudAccounts);
    await app.start();
    await app.createDigitalOceanServer(new Region('_fake-region-id'), false);
    expect(appRoot.currentPage).toEqual('serverView');
    const view = await appRoot.getServerView(appRoot.selectedServerId);
    expect(view.selectedPage).toEqual('progressView');
  });

  it('shows progress screen when starting with DigitalOcean servers still being created', async () => {
    const appRoot = document.getElementById('appRoot') as AppRoot;
    const fakeAccount = new FakeDigitalOceanAccount();
    const server = await fakeAccount.createServer(
      new Region('_fake-region-id')
    );
    const cloudAccounts = new FakeCloudAccounts(fakeAccount);
    const app = createTestApp(appRoot, cloudAccounts);
    // Sets last displayed server.
    localStorage.setItem(LAST_DISPLAYED_SERVER_STORAGE_KEY, server.getId());
    await app.start();
    expect(appRoot.currentPage).toEqual('serverView');
    const view = await appRoot.getServerView(appRoot.selectedServerId);
    expect(view.selectedPage).toEqual('progressView');
  });
});

// A manual server whose health check never completes, to verify that adding a
// server doesn't block on (or depend on) reaching it.
class PendingHealthManualServer extends FakeManualServer {
  isHealthy() {
    return new Promise<boolean>(() => {});
  }
}

class PendingHealthManualServerRepository extends FakeManualServerRepository {
  private pendingServers: server.ManualServer[] = [];

  addServer(config: server.ManualServerConfig) {
    const newServer = new PendingHealthManualServer(config);
    this.pendingServers.push(newServer);
    return Promise.resolve(newServer);
  }

  findServer(config: server.ManualServerConfig) {
    return this.pendingServers.find(
      server => server.getManagementApiUrl() === config.apiUrl
    );
  }

  listServers() {
    return Promise.resolve(this.pendingServers);
  }
}

// A manual server whose health checks stay pending until the test settles
// them, to exercise the connecting and retry states of the server view.
class DeferredHealthManualServer extends FakeManualServer {
  healthChecks = 0;
  private healthResolvers: Array<(healthy: boolean) => void> = [];

  isHealthy() {
    this.healthChecks++;
    return new Promise<boolean>(resolve => this.healthResolvers.push(resolve));
  }

  resolveHealth(healthy: boolean) {
    const resolvers = this.healthResolvers;
    this.healthResolvers = [];
    for (const resolve of resolvers) {
      resolve(healthy);
    }
  }
}

class DeferredHealthManualServerRepository extends FakeManualServerRepository {
  deferredServers: DeferredHealthManualServer[] = [];

  addServer(config: server.ManualServerConfig) {
    const newServer = new DeferredHealthManualServer(config);
    this.deferredServers.push(newServer);
    return Promise.resolve(newServer);
  }

  findServer(config: server.ManualServerConfig) {
    return this.deferredServers.find(
      server => server.getManagementApiUrl() === config.apiUrl
    );
  }

  listServers() {
    return Promise.resolve(this.deferredServers as server.ManualServer[]);
  }
}

// Lets pending promise callbacks and zero-delay timers run.
function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createTestApp(
  appRoot: AppRoot,
  cloudAccounts?: accounts.CloudAccounts,
  manualServerRepo?: server.ManualServerRepository
) {
  const VERSION = '0.0.1';
  if (!cloudAccounts) {
    cloudAccounts = new FakeCloudAccounts();
  }
  if (!manualServerRepo) {
    manualServerRepo = new FakeManualServerRepository();
  }
  return new App(appRoot, VERSION, manualServerRepo, cloudAccounts);
}
