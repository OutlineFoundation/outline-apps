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

import {CustomError} from '@outline/infrastructure/custom_error';

export interface DigitalOceanDropletSpecification {
  installCommand: string;
  size: string;
  image: string;
  tags: string[];
}

// See definition and example at
// https://developers.digitalocean.com/documentation/v2/#retrieve-an-existing-droplet-by-id
export type DropletInfo = Readonly<{
  id: number;
  status: 'new' | 'active';
  tags: string[];
  region: {readonly slug: string};
  size: Readonly<{
    transfer: number;
    price_monthly: number;
  }>;
  networks: Readonly<{
    v4: ReadonlyArray<
      Readonly<{
        type: string;
        ip_address: string;
      }>
    >;
  }>;
}>;

// Reference:
// https://developers.digitalocean.com/documentation/v2/#get-user-information
export type Account = Readonly<{
  droplet_limit: number;
  email: string;
  uuid: string;
  email_verified: boolean;
  status: 'active' | 'warning' | 'locked';
  status_message: string;
}>;

// Reference:
// https://developers.digitalocean.com/documentation/v2/#regions
export type RegionInfo = Readonly<{
  slug: string;
  name: string;
  sizes: string[];
  available: boolean;
  features: string[];
}>;

// Marker class for errors due to network or authentication.
// See below for more details on when this is raised.
export class XhrError extends CustomError {
  constructor() {
    // No message because XMLHttpRequest.onerror provides no useful info.
    super();
  }
}

// This class contains methods to interact with DigitalOcean on behalf of a user.
export interface DigitalOceanSession {
  accessToken: string;
  getAccount(): Promise<Account>;
  createDroplet(
    displayName: string,
    region: string,
    publicKeyForSSH: string,
    dropletSpec: DigitalOceanDropletSpecification
  ): Promise<{droplet: DropletInfo}>;
  deleteDroplet(dropletId: number): Promise<void>;
  getRegionInfo(): Promise<RegionInfo[]>;
  getDroplet(dropletId: number): Promise<DropletInfo>;
  getDropletTags(dropletId: number): Promise<string[]>;
  getDropletsByTag(tag: string): Promise<DropletInfo[]>;
  getDroplets(): Promise<DropletInfo[]>;
}

export class RestApiSession implements DigitalOceanSession {
  // Constructor takes a DigitalOcean access token, which should have
  // read+write permissions.
  constructor(public accessToken: string) {}

  public getAccount(): Promise<Account> {
    console.info('Requesting account');
    return this.request<{account: Account}>('GET', 'account').then(response => {
      return response.account;
    });
  }

  public createDroplet(
    displayName: string,
    region: string,
    publicKeyForSSH: string,
    dropletSpec: DigitalOceanDropletSpecification
  ): Promise<{droplet: DropletInfo}> {
    const dropletName = makeValidDropletName(displayName);
    // Register a key with DigitalOcean, so the user will not get a potentially
    // confusing email with their droplet password, which could get mistaken for
    // an invite.
    return this.registerKey_(dropletName, publicKeyForSSH).then(
      (keyId: number) => {
        return this.makeCreateDropletRequest(
          dropletName,
          region,
          keyId,
          dropletSpec
        );
      }
    );
  }

  private makeCreateDropletRequest(
    dropletName: string,
    region: string,
    keyId: number,
    dropletSpec: DigitalOceanDropletSpecification
  ): Promise<{droplet: DropletInfo}> {
    let requestCount = 0;
    const MAX_REQUESTS = 10;
    const RETRY_TIMEOUT_MS = 5000;
    return new Promise((fulfill, reject) => {
      const makeRequestRecursive = () => {
        ++requestCount;
        console.info(
          `Requesting droplet creation ${requestCount}/${MAX_REQUESTS}`
        );
        // See https://docs.digitalocean.com/reference/api/api-reference/#operation/droplets_create
        this.request<{droplet: DropletInfo}>('POST', 'droplets', {
          name: dropletName,
          region,
          size: dropletSpec.size,
          image: dropletSpec.image,
          ssh_keys: [keyId],
          user_data: dropletSpec.installCommand,
          tags: dropletSpec.tags,
          ipv6: true,
          // We install metrics and droplet agents in the user_data script in order to not delay the droplet readiness.
          monitoring: false,
          with_droplet_agent: false,
        })
          .then(fulfill)
          .catch(e => {
            if (
              e.message.toLowerCase().indexOf('finalizing') >= 0 &&
              requestCount < MAX_REQUESTS
            ) {
              // DigitalOcean is still validating this account and may take
              // up to 30 seconds.  We can retry more frequently to see when
              // this error goes away.
              setTimeout(makeRequestRecursive, RETRY_TIMEOUT_MS);
            } else {
              reject(e);
            }
          });
      };
      makeRequestRecursive();
    });
  }

  public deleteDroplet(dropletId: number): Promise<void> {
    console.info('Requesting droplet deletion');
    return this.request<void>('DELETE', 'droplets/' + dropletId);
  }

  public getRegionInfo(): Promise<RegionInfo[]> {
    console.info('Requesting region info');
    return this.request<{regions: RegionInfo[]}>('GET', 'regions').then(
      response => {
        return response.regions;
      }
    );
  }

  // Registers a SSH key with DigitalOcean.
  private registerKey_(
    keyName: string,
    publicKeyForSSH: string
  ): Promise<number> {
    console.info('Requesting key registration');
    return this.request<{ssh_key: {id: number}}>('POST', 'account/keys', {
      name: keyName,
      public_key: publicKeyForSSH,
    }).then(response => {
      return response.ssh_key.id;
    });
  }

  public getDroplet(dropletId: number): Promise<DropletInfo> {
    console.info('Requesting droplet');
    return this.request<{droplet: DropletInfo}>(
      'GET',
      'droplets/' + dropletId
    ).then(response => {
      return response.droplet;
    });
  }

  public getDropletTags(dropletId: number): Promise<string[]> {
    return this.getDroplet(dropletId).then((droplet: DropletInfo) => {
      return droplet.tags;
    });
  }

  public getDropletsByTag(tag: string): Promise<DropletInfo[]> {
    console.info('Requesting droplet by tag');
    // TODO Add proper pagination support. Going with 100 for now to extend the default of 20, and confirm UI works
    return this.request<{droplets: DropletInfo[]}>(
      'GET',
      `droplets?per_page=100&tag_name=${encodeURI(tag)}`
    ).then(response => {
      return response.droplets;
    });
  }

  public getDroplets(): Promise<DropletInfo[]> {
    console.info('Requesting droplets');
    // TODO Add proper pagination support. Going with 100 for now to extend the default of 20, and confirm UI works
    return this.request<{droplets: DropletInfo[]}>(
      'GET',
      'droplets?per_page=100'
    ).then(response => {
      return response.droplets;
    });
  }

  // Makes an XHR request to DigitalOcean's API, returns a promise which fulfills
  // with the parsed object if successful.
  private request<T>(
    method: string,
    actionPath: string,
    data?: {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, `https://api.digitalocean.com/v2/${actionPath}`);
      xhr.setRequestHeader('Authorization', `Bearer ${this.accessToken}`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = () => {
        // DigitalOcean may return any 2xx status code for success.
        if (xhr.status >= 200 && xhr.status <= 299) {
          // Parse JSON response if available.  For requests like DELETE
          // this.response may be empty.
          const responseObj = xhr.response ? JSON.parse(xhr.response) : {};
          resolve(responseObj);
        } else if (xhr.status === 401) {
          console.error('DigitalOcean request failed with Unauthorized error');
          reject(new XhrError());
        } else {
          // this.response is a JSON object, whose message is an error string.
          const responseJson = JSON.parse(xhr.response);
          console.error(
            `DigitalOcean request failed with status ${xhr.status}`
          );
          reject(
            new Error(
              `XHR ${responseJson.id} failed with ${xhr.status}: ${responseJson.message}`
            )
          );
        }
      };
      xhr.onerror = () => {
        // This is raised for both network-level and CORS (authentication)
        // problems. Since there is, by design for security reasons, no way
        // to programmatically distinguish the two (the error instance
        // passed to this handler has *no* useful information), we should
        // prompt the user for whether to retry or re-authenticate against
        // DigitalOcean (this isn't so bad because application-level
        // errors, e.g. bad request parameters and even 404s, do *not* raise
        // an onerror event).
        console.error('Failed to perform DigitalOcean request');
        reject(new XhrError());
      };
      xhr.send(data ? JSON.stringify(data) : undefined);
    });
  }
}

// Removes invalid characters from input name so it can be used with
// DigitalOcean APIs.
function makeValidDropletName(name: string): string {
  // Remove all characters outside of A-Z, a-z, 0-9 and '-'.
  return name.replace(/[^A-Za-z0-9-]/g, '');
}
