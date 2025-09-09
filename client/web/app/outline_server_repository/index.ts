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

import {Localizer} from '@outline/infrastructure/i18n';
import {makeConfig, SIP002_URI} from 'ShadowsocksConfig';
import uuidv4 from 'uuidv4';

import {newOutlineServer} from './server';
import {TunnelStatus, VpnApi} from './vpn';
import * as errors from '../../model/errors';
import * as events from '../../model/events';
import {ServerRepository} from '../../model/server';
import {Server} from '../../model/server';
import * as methodChannel from '../method_channel';

// Name by which servers are saved to storage.
const SERVERS_STORAGE_KEY_V0 = 'servers';
const SERVERS_STORAGE_KEY = 'servers_v1';

export const TEST_ONLY = {
  SERVERS_STORAGE_KEY_V0: SERVERS_STORAGE_KEY_V0,
  SERVERS_STORAGE_KEY: SERVERS_STORAGE_KEY,
};

// DEPRECATED: V0 server persistence format.
interface ServersStorageV0Config {
  host?: string;
  port?: number;
  password?: string;
  method?: string;
  name?: string;
}

export interface ServersStorageV0 {
  [serverId: string]: ServersStorageV0Config;
}

// Enccodes a V0 storage configuration into an access key string.
export function serversStorageV0ConfigToAccessKey(
  config: ServersStorageV0Config
): string {
  return SIP002_URI.stringify(
    makeConfig({
      host: config.host,
      port: config.port,
      method: config.method,
      password: config.password,
      tag: config.name,
    })
  );
}

// V1 server persistence format.
export type ServersStorageV1 = OutlineServerJson[];

interface OutlineServerJson {
  readonly id: string;
  readonly accessKey: string;
  readonly name: string;
}

type ServerEntry = {accessKey: string; server: Server};

export async function newOutlineServerRepository(
  vpnApi: VpnApi,
  eventQueue: events.EventQueue,
  storage: Storage,
  localize: Localizer
): Promise<ServerRepository> {
  console.debug('OutlineServerRepository is initializing');

  const repo = new OutlineServerRepository(
    vpnApi,
    eventQueue,
    storage,
    localize
  );
  await loadServers(storage, repo);
  console.debug('OutlineServerRepository loaded servers');

  vpnApi.onStatusChange((id: string, status: TunnelStatus) => {
    console.debug(
      `OutlineServerRepository received status update for server ${id}: ${status}`
    );
    let statusEvent: events.OutlineEvent;
    switch (status) {
      case TunnelStatus.CONNECTED:
        statusEvent = new events.ServerConnected(id);
        break;
      case TunnelStatus.DISCONNECTING:
        statusEvent = new events.ServerDisconnecting(id);
        break;
      case TunnelStatus.DISCONNECTED:
        statusEvent = new events.ServerDisconnected(id);
        break;
      case TunnelStatus.RECONNECTING:
        statusEvent = new events.ServerReconnecting(id);
        break;
      default:
        console.warn(
          `Received unknown tunnel status ${status} for tunnel ${id}`
        );
        return;
    }
    eventQueue.enqueue(statusEvent);
  });
  console.debug('OutlineServerRepository registered server status callback');
  return repo;
}

// Maintains a persisted set of servers and liaises with the core.
class OutlineServerRepository implements ServerRepository {
  private lastForgottenServer: ServerEntry | null = null;
  private serverById = new Map<string, ServerEntry>();

  constructor(
    private vpnApi: VpnApi,
    private eventQueue: events.EventQueue,
    private storage: Storage,
    private localize: Localizer
  ) {}

  getAll() {
    return Array.from(this.serverById.values(), e => e.server);
  }

  getById(serverId: string) {
    return this.serverById.get(serverId)?.server;
  }

  async add(accessKey: string): Promise<void> {
    const alreadyAddedServer = this.serverFromAccessKey(accessKey);
    if (alreadyAddedServer) {
      throw new errors.ServerAlreadyAdded(alreadyAddedServer);
    }
    const server = await this.internalCreateServer(
      uuidv4(),
      accessKey,
      undefined
    );

    this.storeServers();
    this.eventQueue.enqueue(new events.ServerAdded(server));
  }

  rename(serverId: string, newName: string) {
    const server = this.getById(serverId);
    if (!server) {
      console.warn(`Cannot rename nonexistent server ${serverId}`);
      return;
    }
    server.name = newName;
    this.storeServers();
    this.eventQueue.enqueue(new events.ServerRenamed(server));
  }

  async forget(serverId: string) {
    const entry = this.serverById.get(serverId);
    if (!entry) {
      console.warn(`Cannot remove nonexistent server ${serverId}`);
      return;
    }
    this.serverById.delete(serverId);
    this.lastForgottenServer = entry;
    this.storeServers();
    await methodChannel
      .getDefaultMethodChannel()
      .invokeMethod('EraseServiceStorage', serverId);
    this.eventQueue.enqueue(new events.ServerForgotten(entry.server));
  }

  undoForget(serverId: string) {
    if (!this.lastForgottenServer) {
      console.warn('No forgotten server to unforget');
      return;
    } else if (this.lastForgottenServer.server.id !== serverId) {
      console.warn(
        'id of forgotten server',
        this.lastForgottenServer,
        'does not match',
        serverId
      );
      return;
    }
    this.serverById.set(
      this.lastForgottenServer.server.id,
      this.lastForgottenServer
    );
    this.storeServers();
    this.eventQueue.enqueue(
      new events.ServerForgetUndone(this.lastForgottenServer.server)
    );
    this.lastForgottenServer = null;
  }

  private serverFromAccessKey(accessKey: string): Server | undefined {
    const trimmedAccessKey = accessKey.trim();
    for (const {accessKey, server} of this.serverById.values()) {
      if (trimmedAccessKey === accessKey.trim()) {
        return server;
      }
    }
    return undefined;
  }

  private storeServers() {
    const servers: ServersStorageV1 = [];
    for (const {accessKey, server} of this.serverById.values()) {
      servers.push({
        id: server.id,
        accessKey,
        name: server.name,
      });
    }
    const json = JSON.stringify(servers);
    this.storage.setItem(SERVERS_STORAGE_KEY, json);
  }

  async internalCreateServer(
    id: string,
    accessKey: string,
    name?: string
  ): Promise<Server> {
    const server = await newOutlineServer(
      this.vpnApi,
      id,
      name,
      accessKey,
      this.localize
    );
    this.serverById.set(id, {accessKey, server});
    return server;
  }
}

// Loads servers from storage, raising an error if there is any problem loading.
async function loadServers(storage: Storage, repo: OutlineServerRepository) {
  if (storage.getItem(SERVERS_STORAGE_KEY)) {
    console.debug('server storage migrated to V1');
    await loadServersV1(storage, repo);
    return;
  }
  await loadServersV0(storage, repo);
}

async function loadServersV0(storage: Storage, repo: OutlineServerRepository) {
  const serversJson = storage.getItem(SERVERS_STORAGE_KEY_V0);
  if (!serversJson) {
    console.debug('no V0 servers found in storage');
    return;
  }
  let configById: ServersStorageV0 = {};
  try {
    configById = JSON.parse(serversJson);
  } catch (e) {
    throw new Error(`could not parse saved V0 servers: ${e.message}`);
  }
  for (const serverId of Object.keys(configById)) {
    const v0Config = configById[serverId];

    try {
      await repo.internalCreateServer(
        serverId,
        serversStorageV0ConfigToAccessKey(v0Config),
        v0Config.name
      );
    } catch (e) {
      // Don't propagate so other stored servers can be created.
      console.error(e);
    }
  }
}

async function loadServersV1(storage: Storage, repo: OutlineServerRepository) {
  const serversStorageJson = storage.getItem(SERVERS_STORAGE_KEY);
  if (!serversStorageJson) {
    console.debug('no servers found in storage');
    return;
  }
  let serversJson: ServersStorageV1 = [];
  try {
    serversJson = JSON.parse(serversStorageJson);
  } catch (e) {
    throw new Error(`could not parse saved servers: ${e.message}`);
  }
  for (const serverJson of serversJson) {
    try {
      await repo.internalCreateServer(
        serverJson.id,
        serverJson.accessKey,
        serverJson.name
      );
    } catch (e) {
      // Don't propagate so other stored servers can be created.
      console.error(e);
    }
  }
}
