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

import {PathApiClient} from '@outline/infrastructure/path_api';
import * as semver from 'semver';

import * as server from '../model/server';

const TIMESTAMP_TO_MS = 1000;

interface AccessKeyJson {
  id: string;
  name: string;
  accessUrl: string;
}

interface ServerConfigJson {
  name: string;
  metricsEnabled: boolean;
  serverId: string;
  createdTimestampMs: number;
  portForNewAccessKeys: number;
  hostnameForAccessKeys: string;
  version: string;
  // This is the server default data limit.  We use this instead of defaultDataLimit for API
  // backwards compatibility.
  accessKeyDataLimit?: server.Data;
}

interface MetricsJson {
  server: {
    tunnelTime: {
      seconds: number;
    };
    dataTransferred: {
      bytes: number;
    };
    bandwidth: {
      current: {
        data: {
          bytes: number;
        };
        timestamp?: number;
      };
      peak: {
        data: {
          bytes: number;
        };
        timestamp?: number;
      };
    };
    locations: {
      location: string;
      asn: number;
      asOrg: string;
      tunnelTime: {
        seconds: number;
      };
      dataTransferred: {
        bytes: number;
      };
    }[];
  };
  accessKeys: {
    accessKeyId: number;
    tunnelTime: {
      seconds: number;
    };
    dataTransferred: {
      bytes: number;
    };
    connection: {
      lastTrafficSeen: number;
      peakDeviceCount: {
        data: number;
        timestamp?: number;
      };
    };
  }[];
}

// Byte transfer stats for the past 30 days, including both inbound and outbound.
// TODO: this is copied at src/shadowbox/model/metrics.ts.  Both copies should
// be kept in sync, until we can find a way to share code between the web_app
// and shadowbox.
interface DataUsageByAccessKeyJson {
  // The accessKeyId should be of type AccessKeyId, however that results in the tsc
  // error TS1023: An index signature parameter type must be 'string' or 'number'.
  // See https://github.com/Microsoft/TypeScript/issues/2491
  // TODO: this still says "UserId", changing to "AccessKeyId" will require
  // a change on the shadowbox server.
  bytesTransferredByUserId: {[accessKeyId: string]: number};
}

// Converts the access key JSON from the API to its model.
function makeAccessKeyModel(apiAccessKey: AccessKeyJson): server.AccessKey {
  return apiAccessKey as server.AccessKey;
}

export class ShadowboxServer implements server.Server {
  private api: PathApiClient;
  private serverConfig: ServerConfigJson;
  private _supportedExperimentalUniversalMetricsEndpointCache: boolean | null =
    null;

  constructor(private readonly id: string) {}

  getId(): string {
    return this.id;
  }

  getAccessKey(accessKeyId: server.AccessKeyId): Promise<server.AccessKey> {
    return this.api
      .request<AccessKeyJson>('access-keys/' + accessKeyId)
      .then(response => {
        return makeAccessKeyModel(response);
      });
  }

  listAccessKeys(): Promise<server.AccessKey[]> {
    console.info('Listing access keys');
    return this.api
      .request<{accessKeys: AccessKeyJson[]}>('access-keys')
      .then(response => {
        return response.accessKeys.map(makeAccessKeyModel);
      });
  }

  async addAccessKey(): Promise<server.AccessKey> {
    console.info('Adding access key');
    return makeAccessKeyModel(
      await this.api.request<AccessKeyJson>('access-keys', 'POST')
    );
  }

  renameAccessKey(
    accessKeyId: server.AccessKeyId,
    name: string
  ): Promise<void> {
    console.info('Renaming access key');
    return this.api.requestForm<void>(
      'access-keys/' + accessKeyId + '/name',
      'PUT',
      {name}
    );
  }

  removeAccessKey(accessKeyId: server.AccessKeyId): Promise<void> {
    console.info('Removing access key');
    return this.api.request<void>('access-keys/' + accessKeyId, 'DELETE');
  }

  async setDefaultDataLimit(limit: server.Data): Promise<void> {
    console.info(`Setting server default data limit: ${JSON.stringify(limit)}`);
    await this.api.requestJson<void>(this.getDefaultDataLimitPath(), 'PUT', {
      limit,
    });
    this.serverConfig.accessKeyDataLimit = limit;
  }

  async removeDefaultDataLimit(): Promise<void> {
    console.info('Removing server default data limit');
    await this.api.request<void>(this.getDefaultDataLimitPath(), 'DELETE');
    delete this.serverConfig.accessKeyDataLimit;
  }

  getDefaultDataLimit(): server.Data | undefined {
    return this.serverConfig.accessKeyDataLimit;
  }

  private getDefaultDataLimitPath(): string {
    const version = this.getVersion();
    if (semver.valid(version) && semver.gte(version, '1.4.0')) {
      // Data limits became a permanent feature in shadowbox v1.4.0.
      return 'server/access-key-data-limit';
    }
    return 'experimental/access-key-data-limit';
  }

  async setAccessKeyDataLimit(
    keyId: server.AccessKeyId,
    limit: server.Data
  ): Promise<void> {
    console.info(
      `Setting data limit of ${limit.bytes} bytes for access key ${keyId}`
    );
    await this.api.requestJson<void>(`access-keys/${keyId}/data-limit`, 'PUT', {
      limit,
    });
  }

  async removeAccessKeyDataLimit(keyId: server.AccessKeyId): Promise<void> {
    console.info(`Removing data limit from access key ${keyId}`);
    await this.api.request<void>(`access-keys/${keyId}/data-limit`, 'DELETE');
  }

  async getServerMetrics(): Promise<{
    server?: server.ServerMetrics;
    accessKeys: server.AccessKeyMetrics[];
  }> {
    if (await this.getSupportedExperimentalUniversalMetricsEndpoint()) {
      const timeRangeInDays = 30;
      const json = await this.api.request<MetricsJson>(
        `experimental/server/metrics?since=${timeRangeInDays}d`
      );

      const convertTimestampToDate = (timestamp?: number) => {
        if (!timestamp) {
          return;
        }

        return new Date(timestamp * TIMESTAMP_TO_MS);
      };

      return {
        server: {
          ...json.server,
          bandwidth: {
            current: {
              data: json.server.bandwidth.current.data,
              timestamp: convertTimestampToDate(
                json.server.bandwidth.current.timestamp
              ),
            },
            peak: {
              data: json.server.bandwidth.peak.data,
              timestamp: convertTimestampToDate(
                json.server.bandwidth.peak.timestamp
              ),
            },
          },
          locations: json.server.locations,
        },
        accessKeys: json.accessKeys.map(key => ({
          ...key,
          accessKeyId: String(key.accessKeyId),
          connection: {
            lastTrafficSeen: convertTimestampToDate(
              key.connection.lastTrafficSeen
            ),
            peakDeviceCount: {
              data: key.connection.peakDeviceCount.data,
              timestamp: convertTimestampToDate(
                key.connection.peakDeviceCount.timestamp
              ),
            },
          },
        })),
      };
    }

    const result: {
      accessKeys: server.AccessKeyMetrics[];
    } = {
      accessKeys: [],
    };

    const jsonResponse =
      await this.api.request<DataUsageByAccessKeyJson>('metrics/transfer');

    for (const [accessKeyId, bytes] of Object.entries(
      jsonResponse.bytesTransferredByUserId
    )) {
      result.accessKeys.push({
        accessKeyId,
        dataTransferred: {bytes},
      });
    }

    return result;
  }

  getName(): string {
    return this.serverConfig?.name;
  }

  async setName(name: string): Promise<void> {
    console.info('Setting server name');
    await this.api.requestJson<void>('name', 'PUT', {name});
    this.serverConfig.name = name;
  }

  getVersion(): string {
    return this.serverConfig.version;
  }

  getMetricsEnabled(): boolean {
    return this.serverConfig.metricsEnabled;
  }

  async setMetricsEnabled(metricsEnabled: boolean): Promise<void> {
    const action = metricsEnabled ? 'Enabling' : 'Disabling';
    console.info(`${action} metrics`);
    await this.api.requestJson<void>('metrics/enabled', 'PUT', {
      metricsEnabled,
    });
    this.serverConfig.metricsEnabled = metricsEnabled;
  }

  getMetricsId(): string {
    return this.serverConfig.serverId;
  }

  isHealthy(timeoutMs = 30000): Promise<boolean> {
    return new Promise<boolean>((fulfill, _reject) => {
      // Query the API and expect a successful response to validate that the
      // service is up and running.
      this.getServerConfig().then(
        serverConfig => {
          this.serverConfig = serverConfig;
          fulfill(true);
        },
        _e => {
          fulfill(false);
        }
      );
      // Return not healthy if API doesn't complete within timeoutMs.
      setTimeout(() => {
        fulfill(false);
      }, timeoutMs);
    });
  }

  getCreatedDate(): Date {
    return new Date(this.serverConfig.createdTimestampMs);
  }

  async setHostnameForAccessKeys(hostname: string): Promise<void> {
    console.info(`setHostname ${hostname}`);
    this.serverConfig.hostnameForAccessKeys = hostname;
    await this.api.requestJson<void>('server/hostname-for-access-keys', 'PUT', {
      hostname,
    });
    this.serverConfig.hostnameForAccessKeys = hostname;
  }

  getHostnameForAccessKeys(): string {
    try {
      return (
        this.serverConfig?.hostnameForAccessKeys ??
        new URL(this.api.base).hostname
      );
    } catch {
      return '';
    }
  }

  getPortForNewAccessKeys(): number | undefined {
    try {
      if (typeof this.serverConfig.portForNewAccessKeys !== 'number') {
        return undefined;
      }
      return this.serverConfig.portForNewAccessKeys;
    } catch {
      return undefined;
    }
  }

  async setPortForNewAccessKeys(newPort: number): Promise<void> {
    console.info(`setPortForNewAccessKeys: ${newPort}`);
    await this.api.requestJson<void>('server/port-for-new-access-keys', 'PUT', {
      port: newPort,
    });
    this.serverConfig.portForNewAccessKeys = newPort;
  }

  private async getServerConfig(): Promise<ServerConfigJson> {
    console.info('Retrieving server configuration');
    return await this.api.request<ServerConfigJson>('server');
  }

  private async getSupportedExperimentalUniversalMetricsEndpoint(): Promise<boolean> {
    if (this._supportedExperimentalUniversalMetricsEndpointCache !== null) {
      return this._supportedExperimentalUniversalMetricsEndpointCache;
    }

    if (!this.api) {
      return false;
    }

    try {
      await this.api.request<MetricsJson>(
        'experimental/server/metrics?since=30d'
      );
      return (this._supportedExperimentalUniversalMetricsEndpointCache = true);
    } catch (error) {
      // endpoint is not defined, keep set to false
      if (error.response?.status !== 404) {
        return false;
      }
    }
  }

  protected setManagementApi(api: PathApiClient): void {
    this.api = api;

    // re-populate the supported endpoint cache
    this._supportedExperimentalUniversalMetricsEndpointCache = null;
    this.getSupportedExperimentalUniversalMetricsEndpoint();
  }

  getManagementApiUrl(): string {
    return this.api.base;
  }
}
