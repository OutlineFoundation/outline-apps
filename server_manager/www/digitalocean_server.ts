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
import {sleep} from '@outline/infrastructure/sleep';
import {ValueStream} from '@outline/infrastructure/value_stream';

import {makePathApiClient} from './fetcher';
import {ShadowboxServer} from './shadowbox_server';
import {DigitalOceanSession, DropletInfo} from '../cloud/digitalocean_api';
import {Region} from '../model/digitalocean';
import * as server from '../model/server';

// Prefix used in key-value tags.
const KEY_VALUE_TAG = 'kv';
// The tag that appears at the beginning of installation.
const INSTALL_STARTED_TAG = 'install-started';
// The tag key for the manager API certificate fingerprint.
const CERTIFICATE_FINGERPRINT_TAG = 'certsha256';
// The tag key for the manager API URL.
const API_URL_TAG = 'apiurl';
// The tag which appears if there is an error during installation.
const INSTALL_ERROR_TAG = 'install-error';

// These are superseded by the API_URL_TAG
// The tag key for the manager API port.
const DEPRECATED_API_PORT_TAG = 'apiport';
// The tag key for the manager API url prefix.
const DEPRECATED_API_PREFIX_TAG = 'apiprefix';

// Possible install states for DigitaloceanServer.
enum InstallState {
  // Unknown state - server may still be installing.
  UNKNOWN = 0,
  // Droplet status is "active"
  DROPLET_CREATED,
  // Userspace is running (detected by the presence of tags)
  DROPLET_RUNNING,
  // The server has generated its management service certificate.
  CERTIFICATE_CREATED,
  // Server is running and has the API URL and certificate fingerprint set.
  COMPLETED,
  // Server installation failed.
  FAILED,
  // Server installation was canceled by the user.
  CANCELED,
}

function getCompletionFraction(state: InstallState): number {
  // Values are based on observed installation timing.
  // Installation typically takes 90 seconds in total.
  switch (state) {
    case InstallState.UNKNOWN:
      return 0.1;
    case InstallState.DROPLET_CREATED:
      return 0.5;
    case InstallState.DROPLET_RUNNING:
      return 0.55;
    case InstallState.CERTIFICATE_CREATED:
      return 0.6;
    case InstallState.COMPLETED:
      return 1.0;
    default:
      return 0;
  }
}

function isFinal(state: InstallState): boolean {
  return (
    state === InstallState.COMPLETED ||
    state === InstallState.FAILED ||
    state === InstallState.CANCELED
  );
}

export class DigitalOceanServer
  extends ShadowboxServer
  implements server.ManagedServer
{
  private onDropletActive: () => void;
  readonly onceDropletActive = new Promise<void>(fulfill => {
    this.onDropletActive = fulfill;
  });
  private installState = new ValueStream<InstallState>(InstallState.UNKNOWN);
  private readonly startTimestamp = Date.now();

  constructor(
    id: string,
    private digitalOcean: DigitalOceanSession,
    private dropletInfo: DropletInfo
  ) {
    // Consider passing a RestEndpoint object to the parent constructor,
    // to better encapsulate the management api address logic.
    super(id);
    console.info('DigitalOceanServer created');
    // Go to the correct initial state based on the initial dropletInfo.
    this.updateInstallState();
    // Start polling for state updates.
    this.pollInstallState();
  }

  async *monitorInstallProgress(): AsyncGenerator<number, void> {
    for await (const state of this.installState.watch()) {
      yield getCompletionFraction(state);
    }

    if (this.installState.get() === InstallState.FAILED) {
      throw new server.ServerInstallFailedError();
    } else if (this.installState.get() === InstallState.CANCELED) {
      throw new server.ServerInstallCanceledError();
    }
  }

  // Synchronous function for updating the installState based on the latest
  // dropletInfo.
  private updateInstallState(): void {
    const TIMEOUT_MS = 5 * 60 * 1000;

    const tagMap = this.getTagMap();
    if (tagMap.get(INSTALL_ERROR_TAG)) {
      console.error(`error tag: ${tagMap.get(INSTALL_ERROR_TAG)}`);
      this.setInstallState(InstallState.FAILED);
    } else if (Date.now() - this.startTimestamp >= TIMEOUT_MS) {
      console.error('hit timeout while waiting for installation');
      this.setInstallState(InstallState.FAILED);
    } else if (this.setApiUrlAndCertificate()) {
      // API Url and Certificate have been set, so we have successfully
      // installed the server and can now make API calls.
      console.info('digitalocean_server: Successfully found API and cert tags');
      this.setInstallState(InstallState.COMPLETED);
    } else if (tagMap.get(CERTIFICATE_FINGERPRINT_TAG)) {
      this.setInstallState(InstallState.CERTIFICATE_CREATED);
    } else if (tagMap.get(INSTALL_STARTED_TAG)) {
      this.setInstallState(InstallState.DROPLET_RUNNING);
    } else if (this.dropletInfo?.status === 'active') {
      this.setInstallState(InstallState.DROPLET_CREATED);
    }
  }

  // Maintains this.installState. Will keep polling until installation has
  // succeeded, failed, or been canceled.
  private async pollInstallState(): Promise<void> {
    // Periodically refresh the droplet info then try to update the install
    // state. If the final install state has been reached, don't make an
    // unnecessary request to fetch droplet info.
    while (!this.installState.isClosed()) {
      try {
        await this.refreshDropletInfo();
      } catch (error) {
        console.log('Failed to get droplet info', error);
        this.setInstallState(InstallState.FAILED);
        return;
      }
      this.updateInstallState();
      // Return immediately if installation is terminated
      // to prevent race conditions and avoid unnecessary delay.
      if (this.installState.isClosed()) {
        return;
      }
      // TODO: If there is an error refreshing the droplet, we should just
      // try again, as there may be an intermittent network issue.
      await sleep(3000);
    }
  }

  private setInstallState(installState: InstallState) {
    this.installState.set(installState);
    if (isFinal(installState)) {
      this.installState.close();
    }
  }

  // Returns true on success, else false.
  private setApiUrlAndCertificate(): boolean {
    try {
      // Attempt to get certificate fingerprint and management api address,
      // these methods throw exceptions if the fields are unavailable.
      const certificateFingerprint = this.getCertificateFingerprint();
      const apiAddress = this.getManagementApiAddress();
      this.setManagementApi(
        makePathApiClient(apiAddress, certificateFingerprint)
      );
      return true;
    } catch {
      // Install state not yet ready.
      return false;
    }
  }

  // Refreshes the state from DigitalOcean API.
  private async refreshDropletInfo(): Promise<void> {
    const newDropletInfo = await this.digitalOcean.getDroplet(
      this.dropletInfo.id
    );
    const oldDropletInfo = this.dropletInfo;
    this.dropletInfo = newDropletInfo;
    if (newDropletInfo.status !== oldDropletInfo.status) {
      if (newDropletInfo.status === 'active') {
        this.onDropletActive();
      }
    }
  }

  // Gets the key-value map stored in the DigitalOcean tags.
  private getTagMap(): Map<string, string> {
    const ret = new Map<string, string>();
    const tagPrefix = KEY_VALUE_TAG + ':';
    for (const tag of this.dropletInfo.tags) {
      if (!startsWithCaseInsensitive(tag, tagPrefix)) {
        continue;
      }
      const keyValuePair = tag.slice(tagPrefix.length);
      const [key, hexValue] = keyValuePair.split(':', 2);
      try {
        ret.set(key.toLowerCase(), hexToString(hexValue));
      } catch {
        console.error('error decoding hex string');
      }
    }
    return ret;
  }

  // Returns the public ipv4 address of this server.
  private ipv4Address() {
    for (const network of this.dropletInfo.networks.v4) {
      if (network.type === 'public') {
        return network.ip_address;
      }
    }
    return undefined;
  }

  // Gets the address for the user management api, throws an error if unavailable.
  private getManagementApiAddress(): string {
    const tagMap = this.getTagMap();
    let apiAddress = tagMap.get(API_URL_TAG);
    // Check the old tags for backward-compatibility.
    // TODO(fortuna): Delete this before we release v1.0
    if (!apiAddress) {
      const portNumber = tagMap.get(DEPRECATED_API_PORT_TAG);
      if (!portNumber) {
        throw new Error('Could not get API port number');
      }
      if (!this.ipv4Address()) {
        throw new Error('API hostname not set');
      }
      apiAddress = `https://${this.ipv4Address()}:${portNumber}/`;
      const apiPrefix = tagMap.get(DEPRECATED_API_PREFIX_TAG);
      if (apiPrefix) {
        apiAddress += apiPrefix + '/';
      }
    }
    if (!apiAddress.endsWith('/')) {
      apiAddress += '/';
    }
    return apiAddress;
  }

  // Gets the certificate fingerprint in binary, throws an error if
  // unavailable.
  private getCertificateFingerprint(): string {
    const fingerprint = this.getTagMap().get(CERTIFICATE_FINGERPRINT_TAG);
    if (fingerprint) {
      return fingerprint;
    } else {
      throw new Error('certificate fingerprint unavailable');
    }
  }

  getHost(): DigitalOceanHost {
    // Construct a new DigitalOceanHost object, to be sure it has the latest
    // session and droplet info.
    return new DigitalOceanHost(
      this.digitalOcean,
      this.dropletInfo,
      this.onDelete.bind(this)
    );
  }

  // Callback to be invoked once server is deleted.
  private onDelete() {
    if (!this.installState.isClosed()) {
      this.setInstallState(InstallState.CANCELED);
    }
  }
}

class DigitalOceanHost implements server.ManagedServerHost {
  constructor(
    private digitalOcean: DigitalOceanSession,
    private dropletInfo: DropletInfo,
    private deleteCallback: Function
  ) {}

  getMonthlyOutboundTransferLimit(): server.DataAmount {
    // Details on the bandwidth limits can be found at
    // https://www.digitalocean.com/community/tutorials/digitalocean-bandwidth-billing-faq
    return {terabytes: this.dropletInfo.size.transfer};
  }

  getMonthlyCost(): server.MonetaryCost {
    return {usd: this.dropletInfo.size.price_monthly};
  }

  getCloudLocation(): Region {
    return new Region(this.dropletInfo.region.slug);
  }

  delete(): Promise<void> {
    this.deleteCallback();
    return this.digitalOcean.deleteDroplet(this.dropletInfo.id);
  }
}

function startsWithCaseInsensitive(text: string, prefix: string) {
  return text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}
