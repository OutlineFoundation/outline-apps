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

import {hexToString} from '@outline/infrastructure/hex_encoding';

import {makePathApiClient} from './fetcher';
import {ShadowboxServer} from './shadowbox_server';
import * as server from '../model/server';

class ManualServer extends ShadowboxServer implements server.ManualServer {
  constructor(
    id: string,
    private manualServerConfig: server.ManualServerConfig,
    private forgetCallback: Function
  ) {
    super(id);
    const fingerprint = hexToString(manualServerConfig.certSha256 ?? '');
    this.setManagementApi(
      makePathApiClient(manualServerConfig.apiUrl, fingerprint)
    );
  }

  getCertificateFingerprint() {
    return this.manualServerConfig.certSha256;
  }

  forget(): void {
    this.forgetCallback();
  }
}

export class ManualServerRepository implements server.ManualServerRepository {
  private servers: server.ManualServer[] = [];

  constructor(private storageKey: string) {
    this.loadServers();
  }

  addServer(config: server.ManualServerConfig): Promise<server.ManualServer> {
    const existingServer = this.findServer(config);
    if (existingServer) {
      console.debug('server already added');
      return Promise.resolve(existingServer);
    }
    const server = this.createServer(config);
    this.servers.push(server);
    this.storeServers();
    return Promise.resolve(server);
  }

  listServers(): Promise<server.ManualServer[]> {
    return Promise.resolve(this.servers);
  }

  findServer(
    config: server.ManualServerConfig
  ): server.ManualServer | undefined {
    return this.servers.find(
      server => server.getManagementApiUrl() === config.apiUrl
    );
  }

  private loadServers() {
    this.servers = [];
    const serversJson = localStorage.getItem(this.storageKey);
    if (serversJson) {
      try {
        const serverConfigs = JSON.parse(serversJson);
        this.servers = serverConfigs.map(
          (config: server.ManualServerConfig) => {
            return this.createServer(config);
          }
        );
      } catch {
        console.error('Error creating manual servers from localStorage');
      }
    }
  }

  private storeServers() {
    const serverConfigs: server.ManualServerConfig[] = this.servers.map(
      server => {
        return {
          apiUrl: server.getManagementApiUrl(),
          certSha256: server.getCertificateFingerprint(),
        };
      }
    );
    localStorage.setItem(this.storageKey, JSON.stringify(serverConfigs));
  }

  private createServer(config: server.ManualServerConfig) {
    const server = new ManualServer(`manual:${config.apiUrl}`, config, () => {
      this.forgetServer(server);
    });
    return server;
  }

  private forgetServer(serverToForget: server.ManualServer): void {
    const apiUrl = serverToForget.getManagementApiUrl();
    this.servers = this.servers.filter(server => {
      return apiUrl !== server.getManagementApiUrl();
    });
    this.storeServers();
  }
}
