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

import {InMemoryStorage} from '@outline/infrastructure/memory_storage';
import {makeConfig, SIP002_URI} from 'ShadowsocksConfig';

import {
  newOutlineServerRepository,
  ServersStorageV0,
  ServersStorageV1,
  serversStorageV0ConfigToAccessKey,
  TEST_ONLY,
} from '.';
import * as config from './config';
import {FakeVpnApi} from './vpn.fake';
import {InvalidServiceConfiguration} from '../../model/errors';
import {
  EventQueue,
  ServerAdded,
  ServerForgetUndone,
  ServerForgotten,
  ServerRenamed,
} from '../../model/events';
import {ServerRepository, Server} from '../../model/server';

// TODO(alalama): unit tests for OutlineServer.

describe('OutlineServerRepository', () => {
  const CONFIG_0_V0 = {
    host: '127.0.0.1',
    port: 1080,
    password: 'test',
    method: 'chacha20-ietf-poly1305',
    name: 'fake server 0',
  };

  const CONFIG_1_V0 = {
    host: '10.0.0.1',
    port: 1089,
    password: 'test',
    method: 'chacha20-ietf-poly1305',
    name: 'fake server 1',
  };

  it('loads V0 servers', async () => {
    const storageV0: ServersStorageV0 = {
      'server-0': CONFIG_0_V0,
      'server-1': CONFIG_1_V0,
    };
    const storage = new InMemoryStorage(
      new Map([[TEST_ONLY.SERVERS_STORAGE_KEY_V0, JSON.stringify(storageV0)]])
    );
    const repo = await newTestRepo(new EventQueue(), storage);
    const server0 = repo.getById('server-0');
    expect(server0?.name).toEqual(CONFIG_0_V0.name);
    const server1 = repo.getById('server-1');
    expect(server1?.name).toEqual(CONFIG_1_V0.name);
  });

  it('loads V1 servers', async () => {
    // Store V0 servers with different ids.
    const storageV0: ServersStorageV0 = {
      'v0-server-0': CONFIG_0_V0,
      'v0-server-1': CONFIG_1_V0,
    };
    const storageV1: ServersStorageV1 = [
      {
        id: 'server-0',
        name: 'fake server 0',
        accessKey: serversStorageV0ConfigToAccessKey(CONFIG_0_V0),
      },
      {
        id: 'server-1',
        name: 'renamed server',
        accessKey: serversStorageV0ConfigToAccessKey(CONFIG_1_V0),
      },
    ];
    const storage = new InMemoryStorage(
      new Map([
        [TEST_ONLY.SERVERS_STORAGE_KEY_V0, JSON.stringify(storageV0)],
        [TEST_ONLY.SERVERS_STORAGE_KEY, JSON.stringify(storageV1)],
      ])
    );
    const repo = await newTestRepo(new EventQueue(), storage);
    const server0 = repo.getById('server-0');
    expect(server0?.name).toEqual(CONFIG_0_V0.name);
    const server1 = repo.getById('server-1');
    expect(server1?.name).toEqual('renamed server');
  });

  it('stores V1 servers', async () => {
    const storageV0: ServersStorageV0 = {
      'server-0': {...CONFIG_0_V0, name: CONFIG_0_V0.name},
      'server-1': {...CONFIG_1_V0, name: CONFIG_1_V0.name},
    };
    const storage = new InMemoryStorage(
      new Map([[TEST_ONLY.SERVERS_STORAGE_KEY_V0, JSON.stringify(storageV0)]])
    );
    const repo = await newTestRepo(new EventQueue(), storage);
    // Trigger storage change.
    await repo.forget('server-1');
    repo.undoForget('server-1');

    const item = storage.getItem(TEST_ONLY.SERVERS_STORAGE_KEY) ?? '';
    expect(item).toBeTruthy();
    const serversJson = JSON.parse(item);
    expect(serversJson).toContain({
      id: 'server-0',
      name: 'fake server 0',
      accessKey: serversStorageV0ConfigToAccessKey(CONFIG_0_V0),
    });
    expect(serversJson).toContain({
      id: 'server-1',
      name: 'fake server 1',
      accessKey: serversStorageV0ConfigToAccessKey(CONFIG_1_V0),
    });
  });

  it('add stores servers', async () => {
    const storage = new InMemoryStorage();
    const repo = await newTestRepo(new EventQueue(), storage);
    const accessKey0 = serversStorageV0ConfigToAccessKey(CONFIG_0_V0);
    const accessKey1 = serversStorageV0ConfigToAccessKey(CONFIG_1_V0);
    await repo.add(accessKey0);
    await repo.add(accessKey1);
    const item = storage.getItem(TEST_ONLY.SERVERS_STORAGE_KEY) ?? '';
    expect(item).toBeTruthy();
    const servers: ServersStorageV1 = JSON.parse(item);
    expect(servers.length).toEqual(2);
    expect(servers[0].accessKey).toEqual(accessKey0);
    expect(servers[0].name).toEqual(CONFIG_0_V0.name);
    expect(servers[1].accessKey).toEqual(accessKey1);
    expect(servers[1].name).toEqual(CONFIG_1_V0.name);
  });

  it('add emits ServerAdded event', async () => {
    const eventQueue = new EventQueue();
    const repo = await newTestRepo(eventQueue, new InMemoryStorage());
    const accessKey = serversStorageV0ConfigToAccessKey(CONFIG_0_V0);
    await repo.add(accessKey);
    let didEmitServerAddedEvent = false;
    eventQueue.subscribe(ServerAdded, (event: ServerAdded) => {
      const server = event.server as Server;
      expect(server.name).toEqual(CONFIG_0_V0.name);
      didEmitServerAddedEvent = true;
    });
    eventQueue.startPublishing();
    expect(didEmitServerAddedEvent).toBeTruthy();
  });

  it('add throws on invalid access keys', async () => {
    const repo = await newTestRepo(new EventQueue(), new InMemoryStorage());
    await expectAsync(repo.add('ss://invalid')).toBeRejectedWithError(
      InvalidServiceConfiguration
    );
    await expectAsync(repo.add('')).toBeRejectedWithError(
      InvalidServiceConfiguration
    );
  });

  it('getAll returns added servers', async () => {
    const repo = await newTestRepo(new EventQueue(), new InMemoryStorage());
    expect(repo.getAll()).toEqual([]);
    const accessKey0 = serversStorageV0ConfigToAccessKey(CONFIG_0_V0);
    const accessKey1 = serversStorageV0ConfigToAccessKey(CONFIG_1_V0);
    await repo.add(accessKey0);
    await repo.add(accessKey1);
    const servers = repo.getAll();
    expect(servers.length).toEqual(2);
    const serverNames = servers.map(s => s.name);
    expect(serverNames).toContain(CONFIG_0_V0.name);
    expect(serverNames).toContain(CONFIG_1_V0.name);
  });

  it('getById retrieves added servers', async () => {
    const repo = await newTestRepo(new EventQueue(), new InMemoryStorage());
    const accessKey = serversStorageV0ConfigToAccessKey(CONFIG_0_V0);
    await repo.add(accessKey);
    const serverId = repo.getAll()[0].id;
    const server = repo.getById(serverId);
    expect(server?.id).toEqual(serverId);
    expect(server?.name).toEqual(CONFIG_0_V0.name);
  });

  it('getById returns undefined for nonexistent servers', async () => {
    const repo = await newTestRepo(new EventQueue(), new InMemoryStorage());
    expect(repo.getById('server-does-not-exist')).toBeUndefined();
    expect(repo.getById('')).toBeUndefined();
  });

  it('renames servers', async () => {
    const NEW_SERVER_NAME = 'new server name';
    const storage = new InMemoryStorage();
    const repo = await newTestRepo(new EventQueue(), storage);
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_0_V0));
    const server = repo.getAll()[0];
    repo.rename(server.id, NEW_SERVER_NAME);
    expect(server.name).toEqual(NEW_SERVER_NAME);
    const item = storage.getItem(TEST_ONLY.SERVERS_STORAGE_KEY) ?? '';
    expect(item).toBeTruthy();
    const serversStorage: ServersStorageV1 = JSON.parse(item);
    const serverNames = serversStorage.map(s => s.name);
    expect(serverNames).toContain(NEW_SERVER_NAME);
  });

  it('rename emits ServerRenamed event', async () => {
    const NEW_SERVER_NAME = 'new server name';
    const eventQueue = new EventQueue();
    eventQueue.subscribe(ServerAdded, () => {}); // Silence dropped event warnings.
    const repo = await newTestRepo(eventQueue, new InMemoryStorage());
    const accessKey = serversStorageV0ConfigToAccessKey(CONFIG_0_V0);
    await repo.add(accessKey);
    const server = repo.getAll()[0];
    repo.rename(server.id, NEW_SERVER_NAME);
    let didEmitServerRenamedEvent = false;
    eventQueue.subscribe(ServerRenamed, (event: ServerRenamed) => {
      expect(event.server.name).toEqual(NEW_SERVER_NAME);
      didEmitServerRenamedEvent = true;
    });
    eventQueue.startPublishing();
    expect(didEmitServerRenamedEvent).toBeTruthy();
  });

  it('forgets servers', async () => {
    const storage = new InMemoryStorage();
    const repo = await newTestRepo(new EventQueue(), storage);
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_0_V0));
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_1_V0));
    const forgottenServerId = repo.getAll()[0].id;
    await repo.forget(forgottenServerId);
    expect(repo.getById(forgottenServerId)).toBeUndefined();
    const serverIds = repo.getAll().map(s => s.id);
    expect(serverIds.length).toEqual(1);
    expect(serverIds).not.toContain(forgottenServerId);
    const item = storage.getItem(TEST_ONLY.SERVERS_STORAGE_KEY) ?? '';
    expect(item).toBeTruthy();
    const serversStorage: ServersStorageV1 = JSON.parse(item);
    const serverIdsStorage = serversStorage.map(s => s.id);
    expect(serverIdsStorage).not.toContain(forgottenServerId);
  });

  it('forget emits ServerForgotten events', async () => {
    const eventQueue = new EventQueue();
    eventQueue.subscribe(ServerAdded, () => {}); // Silence dropped event warnings.
    const repo = await newTestRepo(eventQueue, new InMemoryStorage());
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_0_V0));
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_1_V0));
    const forgottenServerId = repo.getAll()[0].id;
    await repo.forget(forgottenServerId);
    let didEmitServerForgottenEvent = false;
    eventQueue.subscribe(ServerForgotten, (event: ServerForgotten) => {
      expect(event.server.id).toEqual(forgottenServerId);
      didEmitServerForgottenEvent = true;
    });
    eventQueue.startPublishing();
    expect(didEmitServerForgottenEvent).toBeTruthy();
  });

  it('undoes forgetting servers', async () => {
    const storage = new InMemoryStorage();
    const repo = await newTestRepo(new EventQueue(), storage);
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_0_V0));
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_1_V0));
    const forgottenServerId = repo.getAll()[0].id;
    await repo.forget(forgottenServerId);
    repo.undoForget(forgottenServerId);
    const forgottenServer = repo.getById(forgottenServerId);
    expect(forgottenServer?.id).toEqual(forgottenServerId);
    const serverIds = repo.getAll().map(s => s.id);
    expect(serverIds.length).toEqual(2);
    expect(serverIds).toContain(forgottenServerId);
    const item = storage.getItem(TEST_ONLY.SERVERS_STORAGE_KEY) ?? '';
    expect(item).toBeTruthy();
    const serversStorage: ServersStorageV1 = JSON.parse(item);
    const serverIdsStorage = serversStorage.map(s => s.id);
    expect(serverIdsStorage).toContain(forgottenServerId);
  });

  it('undoForget emits ServerForgetUndone events', async () => {
    const eventQueue = new EventQueue();
    // Silence dropped event warnings.
    eventQueue.subscribe(ServerAdded, () => {});
    eventQueue.subscribe(ServerForgotten, () => {});
    const repo = await newTestRepo(eventQueue, new InMemoryStorage());
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_0_V0));
    await repo.add(serversStorageV0ConfigToAccessKey(CONFIG_1_V0));
    const forgottenServerId = repo.getAll()[0].id;
    await repo.forget(forgottenServerId);
    repo.undoForget(forgottenServerId);
    let didEmitServerForgetUndoneEvent = false;
    eventQueue.subscribe(ServerForgetUndone, (event: ServerForgetUndone) => {
      expect(event.server.id).toEqual(forgottenServerId);
      didEmitServerForgetUndoneEvent = true;
    });
    eventQueue.startPublishing();
    expect(didEmitServerForgetUndoneEvent).toBeTruthy();
  });

  it('validates static access keys', async () => {
    // Invalid access keys.
    await expectAsync(config.parseAccessKey('')).toBeRejectedWithError(
      InvalidServiceConfiguration
    );
    await expectAsync(
      config.parseAccessKey('ss://invalid')
    ).toBeRejectedWithError(InvalidServiceConfiguration);
    // IPv6 host.
    expect(
      await config.parseAccessKey(
        SIP002_URI.stringify(
          makeConfig({
            host: '2001:0:ce49:7601:e866:efff:62c3:fffe',
            port: 443,
            password: 'test',
            method: 'chacha20-ietf-poly1305',
          })
        )
      )
    ).toBeTruthy();
  });
});

async function newTestRepo(
  eventQueue: EventQueue,
  storage: Storage
): Promise<ServerRepository> {
  return await newOutlineServerRepository(
    new FakeVpnApi(),
    eventQueue,
    storage,
    _ => {
      return 'Outline Server';
    }
  );
}
