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
import * as path_api from '@outline/infrastructure/path_api';
import {sleep} from '@outline/infrastructure/sleep';
import * as Sentry from '@sentry/electron/renderer';
import * as semver from 'semver';

import {DisplayDataAmount, displayDataAmountToBytes} from './data_formatting';
import {filterOptions, getShortName, sortOptions} from './location_formatting';
import {parseManualServerConfig} from './management_urls';
import type {AppRoot, ServerListEntry} from './ui_components/app-root';
import {FeedbackDetail} from './ui_components/outline-feedback-dialog';
import type {ServerView} from './ui_components/outline-server-view';
import * as digitalocean_api from '../cloud/digitalocean_api';
import {HttpError} from '../cloud/gcp_api';
import * as accounts from '../model/accounts';
import * as digitalocean from '../model/digitalocean';
import * as gcp from '../model/gcp';
import type {CloudLocation} from '../model/location';
import * as server_model from '../model/server';

// The Outline DigitalOcean team's referral code:
//   https://www.digitalocean.com/help/referral-program/
//const UNUSED_DIGITALOCEAN_REFERRAL_CODE = '5ddb4219b716';

const CHANGE_KEYS_PORT_VERSION = '1.0.0';
const DATA_LIMITS_VERSION = '1.1.0';
const CHANGE_HOSTNAME_VERSION = '1.2.0';
const KEY_SETTINGS_VERSION = '1.6.0';
const MINUTES_TO_MILLISECONDS = 60 * 1000;
const MAX_ACCESS_KEY_DATA_LIMIT_BYTES = 50 * 10 ** 9; // 50GB
const CANCELLED_ERROR = new Error('Cancelled');
const CHARACTER_TABLE_FLAG_SYMBOL_OFFSET = 127397;
export const LAST_DISPLAYED_SERVER_STORAGE_KEY = 'lastDisplayedServer';

// todo (#1311): we are referencing `@sentry/electron` which won't work for
//               web_app. It's ok for now cuz we don't need to enable Sentry in
//               web_app, but a better solution is to have separate two entry
//               points: electron_main (uses `@sentry/electron`) and web_main
//               (uses `@sentry/browser`).
// For all other Sentry config see the main process.
Sentry.init({
  beforeBreadcrumb:
    typeof redactSentryBreadcrumbUrl === 'function'
      ? redactSentryBreadcrumbUrl
      : null,
});

function displayDataAmountToDataLimit(
  dataAmount: DisplayDataAmount
): server_model.Data | null {
  if (!dataAmount) {
    return null;
  }

  return {bytes: displayDataAmountToBytes(dataAmount)};
}

// Compute the suggested data limit based on the server's transfer capacity and number of access
// keys.
async function computeDefaultDataLimit(
  server: server_model.Server,
  accessKeys?: server_model.AccessKey[]
): Promise<server_model.Data> {
  try {
    // Assume non-managed servers have a data transfer capacity of 1TB.
    let serverTransferCapacity: server_model.DataAmount = {terabytes: 1};
    if (isManagedServer(server)) {
      serverTransferCapacity =
        server.getHost().getMonthlyOutboundTransferLimit() ??
        serverTransferCapacity;
    }
    if (!accessKeys) {
      accessKeys = await server.listAccessKeys();
    }
    let dataLimitBytes =
      (serverTransferCapacity.terabytes * 10 ** 12) / (accessKeys.length || 1);
    if (dataLimitBytes > MAX_ACCESS_KEY_DATA_LIMIT_BYTES) {
      dataLimitBytes = MAX_ACCESS_KEY_DATA_LIMIT_BYTES;
    }
    return {bytes: dataLimitBytes};
  } catch (e) {
    console.error(`Failed to compute default access key data limit: ${e}`);
    return {bytes: MAX_ACCESS_KEY_DATA_LIMIT_BYTES};
  }
}

// Returns whether the user has seen a notification for the updated feature metrics data collection
// policy.
function hasSeenFeatureMetricsNotification(): boolean {
  return (
    !!window.localStorage.getItem('dataLimitsHelpBubble-dismissed') &&
    !!window.localStorage.getItem('dataLimits-feature-collection-notification')
  );
}

async function showHelpBubblesOnce(serverView: ServerView) {
  if (!window.localStorage.getItem('getConnectedHelpBubble-dismissed')) {
    await serverView.showGetConnectedHelpBubble();
    window.localStorage.setItem('getConnectedHelpBubble-dismissed', 'true');
  }
  if (!window.localStorage.getItem('addAccessKeyHelpBubble-dismissed')) {
    await serverView.showAddAccessKeyHelpBubble();
    window.localStorage.setItem('addAccessKeyHelpBubble-dismissed', 'true');
  }
  if (
    !window.localStorage.getItem('dataLimitsHelpBubble-dismissed') &&
    serverView.supportsDefaultDataLimit
  ) {
    await serverView.showDataLimitsHelpBubble();
    window.localStorage.setItem('dataLimitsHelpBubble-dismissed', 'true');
  }
}

function isManagedServer(
  testServer: server_model.Server
): testServer is server_model.ManagedServer {
  return !!(testServer as server_model.ManagedServer).getHost;
}

function isManualServer(
  testServer: server_model.Server
): testServer is server_model.ManualServer {
  return !!(testServer as server_model.ManualServer).forget;
}

// Error thrown when a shadowbox server cannot be reached (e.g. due to Firewall)
class UnreachableServerError extends CustomError {
  constructor(message?: string) {
    super(message);
  }
}

export class App {
  private digitalOceanAccount: digitalocean.Account;
  private gcpAccount: gcp.Account;
  private selectedServer: server_model.Server;
  private idServerMap = new Map<string, server_model.Server>();

  constructor(
    private appRoot: AppRoot,
    private readonly version: string,
    private manualServerRepository: server_model.ManualServerRepository,
    private cloudAccounts: accounts.CloudAccounts
  ) {
    appRoot.setAttribute('outline-version', this.version);

    appRoot.addEventListener(
      'ConnectDigitalOceanAccountRequested',
      (_: CustomEvent) => {
        this.handleConnectDigitalOceanAccountRequest();
      }
    );
    appRoot.addEventListener(
      'CreateDigitalOceanServerRequested',
      (_: CustomEvent) => {
        const digitalOceanAccount = this.cloudAccounts.getDigitalOceanAccount();
        if (digitalOceanAccount) {
          this.showDigitalOceanCreateServer(digitalOceanAccount);
        } else {
          console.error('Access token not found for server creation');
          this.handleConnectDigitalOceanAccountRequest();
        }
      }
    );
    appRoot.addEventListener(
      'ConnectGcpAccountRequested',
      async (_: CustomEvent) => this.handleConnectGcpAccountRequest()
    );
    appRoot.addEventListener(
      'CreateGcpServerRequested',
      async (_: CustomEvent) => {
        this.appRoot.getAndShowGcpCreateServerApp().start(this.gcpAccount);
      }
    );
    appRoot.addEventListener('GcpServerCreated', (event: CustomEvent) => {
      const {server} = event.detail;
      this.addServer(this.gcpAccount.getId(), server);
      this.showServer(server);
    });
    appRoot.addEventListener(
      'DigitalOceanSignOutRequested',
      (_: CustomEvent) => {
        this.disconnectDigitalOceanAccount();
        this.showIntro();
      }
    );
    appRoot.addEventListener('GcpSignOutRequested', (_: CustomEvent) => {
      this.disconnectGcpAccount();
      this.showIntro();
    });

    appRoot.addEventListener(
      'SetUpDigitalOceanServerRequested',
      (event: CustomEvent) => {
        this.createDigitalOceanServer(
          event.detail.region,
          event.detail.metricsEnabled
        );
      }
    );

    appRoot.addEventListener('DeleteServerRequested', (event: CustomEvent) => {
      this.deleteServer(event.detail.serverId);
    });

    appRoot.addEventListener('ForgetServerRequested', (event: CustomEvent) => {
      this.forgetServer(event.detail.serverId);
    });

    appRoot.addEventListener('AddAccessKeyRequested', (_: CustomEvent) => {
      this.addAccessKey();
    });

    appRoot.addEventListener(
      'RemoveAccessKeyRequested',
      (event: CustomEvent) => {
        this.removeAccessKey(event.detail.accessKeyId);
      }
    );

    appRoot.addEventListener(
      'OpenPerKeyDataLimitDialogRequested',
      this.openPerKeyDataLimitDialog.bind(this)
    );

    appRoot.addEventListener(
      'RenameAccessKeyRequested',
      (event: CustomEvent) => {
        this.renameAccessKey(event.detail.accessKeyId, event.detail.newName);
      }
    );

    appRoot.addEventListener(
      'SetDefaultDataLimitRequested',
      (event: CustomEvent) => {
        this.setDefaultDataLimit(
          displayDataAmountToDataLimit(event.detail.limit)
        );
      }
    );

    appRoot.addEventListener(
      'RemoveDefaultDataLimitRequested',
      (_: CustomEvent) => {
        this.removeDefaultDataLimit();
      }
    );

    appRoot.addEventListener(
      'ChangePortForNewAccessKeysRequested',
      (event: CustomEvent) => {
        this.setPortForNewAccessKeys(
          event.detail.validatedInput,
          event.detail.ui
        );
      }
    );

    appRoot.addEventListener(
      'ChangeHostnameForAccessKeysRequested',
      (event: CustomEvent) => {
        this.setHostnameForAccessKeys(
          event.detail.validatedInput,
          event.detail.ui
        );
      }
    );

    // The UI wants us to validate a server management URL.
    // "Reply" by setting a field on the relevant template.
    appRoot.addEventListener('ManualServerEdited', (event: CustomEvent) => {
      let isValid = true;
      try {
        parseManualServerConfig(event.detail.userInput);
      } catch {
        isValid = false;
      }
      const manualServerEntryEl = appRoot.getManualServerEntry();
      manualServerEntryEl.enableDoneButton = isValid;
    });

    appRoot.addEventListener('ManualServerEntered', (event: CustomEvent) => {
      const userInput = event.detail.userInput;
      const manualServerEntryEl = appRoot.getManualServerEntry();
      this.createManualServer(userInput)
        .then(() => {
          // Clear fields on outline-manual-server-entry (e.g. dismiss the connecting popup).
          manualServerEntryEl.clear();
        })
        .catch((e: Error) => {
          // Remove the progress indicator.
          manualServerEntryEl.showConnection = false;
          // Display either error dialog or feedback depending on error type.
          if (e instanceof UnreachableServerError) {
            const errorTitle = appRoot.localize(
              'error-server-unreachable-title'
            );
            const errorMessage = appRoot.localize('error-server-unreachable');
            this.appRoot.showManualServerError(errorTitle, errorMessage);
          } else {
            // TODO(alalama): with UI validation, this code path never gets executed. Remove?
            let errorMessage = '';
            if (e.message) {
              errorMessage += `${e.message}\n`;
            }
            if (userInput) {
              errorMessage += userInput;
            }
            appRoot.openManualInstallFeedback(errorMessage);
          }
        });
    });

    appRoot.addEventListener('EnableMetricsRequested', (_: CustomEvent) => {
      this.setMetricsEnabled(true);
    });

    appRoot.addEventListener('DisableMetricsRequested', (_: CustomEvent) => {
      this.setMetricsEnabled(false);
    });

    appRoot.addEventListener('SubmitFeedback', (event: CustomEvent) => {
      const detail: FeedbackDetail = event.detail;
      try {
        Sentry.captureEvent({
          message: detail.userFeedback,
          user: {email: detail.userEmail},
          tags: {
            category: detail.feedbackCategory,
            cloudProvider: detail.cloudProvider,
          },
        });
        appRoot.showNotification(
          appRoot.localize('notification-feedback-thanks')
        );
      } catch (e) {
        console.error(`Failed to submit feedback: ${e}`);
        appRoot.showError(appRoot.localize('error-feedback'));
      }
    });

    appRoot.addEventListener('SetLanguageRequested', (event: CustomEvent) => {
      this.setAppLanguage(event.detail.languageCode, event.detail.languageDir);
    });

    appRoot.addEventListener('ServerRenameRequested', (event: CustomEvent) => {
      this.renameServer(event.detail.newName);
    });

    appRoot.addEventListener(
      'CancelServerCreationRequested',
      (_: CustomEvent) => {
        this.cancelServerCreation(this.selectedServer);
      }
    );

    appRoot.addEventListener('OpenImageRequested', (event: CustomEvent) => {
      openImage(event.detail.imagePath);
    });

    appRoot.addEventListener(
      'OpenShareDialogRequested',
      (event: CustomEvent) => {
        const accessKey = event.detail.accessKey;
        this.appRoot.openShareDialog(accessKey);
      }
    );

    appRoot.addEventListener('ShowServerRequested', (event: CustomEvent) => {
      const server = this.getServerById(event.detail.displayServerId);
      if (server) {
        this.showServer(server);
      } else {
        // This should never happen if we are managine the list correctly.
        console.error(
          `Could not find server for display server ID ${event.detail.displayServerId}`
        );
      }
    });

    onUpdateDownloaded(this.displayAppUpdateNotification.bind(this));
  }

  // Shows the intro screen with overview and options to sign in or sign up.
  private showIntro() {
    this.appRoot.showIntro();
  }

  private displayAppUpdateNotification() {
    this.appRoot.showNotification(
      this.appRoot.localize('notification-app-update'),
      60000
    );
  }

  async start(): Promise<void> {
    this.showIntro();

    // Load connected accounts and servers.
    await Promise.all([
      this.loadDigitalOceanAccount(this.cloudAccounts.getDigitalOceanAccount()),
      this.loadGcpAccount(this.cloudAccounts.getGcpAccount()),
      this.loadManualServers(),
    ]);

    // Show last displayed server, if any.
    const serverIdToSelect = localStorage.getItem(
      LAST_DISPLAYED_SERVER_STORAGE_KEY
    );
    if (serverIdToSelect) {
      const serverToShow = this.getServerById(serverIdToSelect);
      if (serverToShow) {
        this.showServer(serverToShow);
      }
    }
  }

  private async loadDigitalOceanAccount(
    digitalOceanAccount: digitalocean.Account
  ): Promise<server_model.ManagedServer[]> {
    if (!digitalOceanAccount) {
      return [];
    }
    let showedWarning = false;
    try {
      this.digitalOceanAccount = digitalOceanAccount;
      this.appRoot.digitalOceanAccount = {
        id: this.digitalOceanAccount.getId(),
        name: await this.digitalOceanAccount.getName(),
      };
      const status = await this.digitalOceanAccount.getStatus();
      if (status.warning) {
        this.showDigitalOceanWarning(status);
        showedWarning = true;
      }
      const servers = await this.digitalOceanAccount.listServers();
      for (const server of servers) {
        this.addServer(this.digitalOceanAccount.getId(), server);
      }
      return servers;
    } catch (error) {
      // TODO(fortuna): Handle expired token.
      if (!showedWarning) {
        this.appRoot.showError(this.appRoot.localize('error-do-account-info'));
      }
      console.error('Failed to load DigitalOcean Account:', error);
    }
    return [];
  }

  private showDigitalOceanWarning(status: digitalocean.Status) {
    this.appRoot.showError(
      this.appRoot.localize('error-do-warning', 'message', status.warning)
    );
  }

  private async loadGcpAccount(
    gcpAccount: gcp.Account
  ): Promise<server_model.ManagedServer[]> {
    if (!gcpAccount) {
      return [];
    }

    this.gcpAccount = gcpAccount;
    this.appRoot.gcpAccount = {
      id: this.gcpAccount.getId(),
      name: await this.gcpAccount.getName(),
    };

    const result = [];
    const gcpProjects = await this.gcpAccount.listProjects();
    for (const gcpProject of gcpProjects) {
      try {
        const servers = await this.gcpAccount.listServers(gcpProject.id);
        for (const server of servers) {
          this.addServer(this.gcpAccount.getId(), server);
          result.push(server);
        }
      } catch (e) {
        if (e instanceof HttpError && e.getStatusCode() === 403) {
          // listServers() throws an HTTP 403 if the outline project has been
          // created but the billing account has been removed, which can
          // easily happen after the free trial period expires.  This is
          // harmless, because a project with no billing cannot contain any
          // servers, and the GCP server creation flow will check and correct
          // the billing account setup.
          console.warn(`Ignoring HTTP 403 for GCP project "${gcpProject.id}"`);
        } else {
          throw e;
        }
      }
    }
    return result;
  }

  private async loadManualServers() {
    for (const server of await this.manualServerRepository.listServers()) {
      this.addServer(null, server);
    }
  }

  private makeServerListEntry(
    accountId: string,
    server: server_model.Server
  ): ServerListEntry {
    return {
      id: server.getId(),
      accountId,
      name: this.makeDisplayName(server),
      isSynced: !!server.getName(),
    };
  }

  private makeDisplayName(server: server_model.Server): string {
    let name = server.getName() ?? server.getHostnameForAccessKeys();
    if (!name) {
      let cloudLocation = null;
      // Newly created servers will not have a name.
      if (isManagedServer(server)) {
        cloudLocation = server.getHost().getCloudLocation();
      }
      name = this.makeLocalizedServerName(cloudLocation);
    }
    return name;
  }

  private addServer(accountId: string, server: server_model.Server): void {
    console.log('Loading server', server);
    this.idServerMap.set(server.getId(), server);
    const serverEntry = this.makeServerListEntry(accountId, server);
    this.appRoot.serverList = this.appRoot.serverList.concat([serverEntry]);

    if (isManagedServer(server)) {
      this.setServerProgressView(server);
    }

    // Once the server is added to the list, do the rest asynchronously.
    setTimeout(async () => {
      // Wait for server config to load, then update the server view and list.
      if (isManagedServer(server)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _ of server.monitorInstallProgress()) {
            /* empty */
          }
        } catch (error) {
          if (error instanceof server_model.ServerInstallCanceledError) {
            // User clicked "Cancel" on the loading screen.
            return;
          }
          console.log('Server creation failed', error);
          this.appRoot.showError(
            this.appRoot.localize('error-server-creation')
          );
        }
      }
      await this.updateServerView(server);
      // This has to run after updateServerView because it depends on the isHealthy() call.
      // TODO(fortuna): Better handle state changes.
      this.updateServerEntry(server);
    }, 0);
  }

  private removeServer(serverId: string): void {
    this.idServerMap.delete(serverId);
    this.appRoot.serverList = this.appRoot.serverList.filter(
      ds => ds.id !== serverId
    );
    if (this.appRoot.selectedServerId === serverId) {
      this.appRoot.selectedServerId = '';
      this.selectedServer = null;
      localStorage.removeItem(LAST_DISPLAYED_SERVER_STORAGE_KEY);
    }
  }

  private updateServerEntry(server: server_model.Server): void {
    this.appRoot.serverList = this.appRoot.serverList.map(ds =>
      ds.id === server.getId()
        ? this.makeServerListEntry(ds.accountId, server)
        : ds
    );
  }

  private getServerById(serverId: string): server_model.Server {
    return this.idServerMap.get(serverId);
  }

  // Returns a promise that resolves when the account is active.
  // Throws CANCELLED_ERROR on cancellation, and the error on failure.
  private async ensureActiveDigitalOceanAccount(
    digitalOceanAccount: digitalocean.Account
  ): Promise<void> {
    let cancelled = false;
    let activatingAccount = false;

    // TODO(fortuna): Provide a cancel action instead of sign out.
    const signOutAction = () => {
      cancelled = true;
      this.disconnectDigitalOceanAccount();
    };
    const oauthUi = this.appRoot.getDigitalOceanOauthFlow(signOutAction);
    for (;;) {
      const status = await this.digitalOceanRetry(async () => {
        if (cancelled) {
          throw CANCELLED_ERROR;
        }
        return await digitalOceanAccount.getStatus();
      });
      if (status.needsBillingInfo) {
        oauthUi.showBilling();
      } else if (status.needsEmailVerification) {
        oauthUi.showEmailVerification();
      } else {
        if (status.warning) {
          this.showDigitalOceanWarning(status);
        }
        bringToFront();
        if (activatingAccount) {
          // Show the 'account active' screen for a few seconds if the account was activated
          // during this session.
          oauthUi.showAccountActive();
          await sleep(1500);
        }
        return;
      }
      this.appRoot.showDigitalOceanOauthFlow();
      activatingAccount = true;
      await sleep(1000);
      if (this.appRoot.currentPage !== 'digitalOceanOauth') {
        // The user navigated away.
        cancelled = true;
      }
      if (cancelled) {
        throw CANCELLED_ERROR;
      }
    }
  }

  // Intended to add a "retry or re-authenticate?" prompt to DigitalOcean
  // operations. Specifically, any operation rejecting with an digitalocean_api.XhrError will
  // result in a dialog asking the user whether to retry the operation or
  // re-authenticate against DigitalOcean.
  // This is necessary because an access token may expire or be revoked at
  // any time and there's no way to programmatically distinguish network errors
  // from CORS-type errors (see the comments in DigitalOceanSession for more
  // information).
  // TODO: It would be great if, once the user has re-authenticated, we could
  //       return the UI to its exact prior state. Fortunately, the most likely
  //       time to discover an invalid access token is when the application
  //       starts.
  private digitalOceanRetry = <T>(f: () => Promise<T>): Promise<T> => {
    return f().catch(e => {
      if (!(e instanceof digitalocean_api.XhrError)) {
        return Promise.reject(e);
      }

      return new Promise<T>((resolve, reject) => {
        this.appRoot.showConnectivityDialog((retry: boolean) => {
          if (retry) {
            this.digitalOceanRetry(f).then(resolve, reject);
          } else {
            this.disconnectDigitalOceanAccount();
            reject(e);
          }
        });
      });
    });
  };

  // Runs the DigitalOcean OAuth flow and returns the API access token.
  // Throws CANCELLED_ERROR on cancellation, or the error in case of failure.
  private async runDigitalOceanOauthFlow(): Promise<string> {
    const oauth = runDigitalOceanOauth();
    const handleOauthFlowCancelled = () => {
      oauth.cancel();
      this.disconnectDigitalOceanAccount();
      this.showIntro();
    };
    this.appRoot.getAndShowDigitalOceanOauthFlow(handleOauthFlowCancelled);
    try {
      // DigitalOcean tokens expire after 30 days, unless they are manually
      // revoked by the user. After 30 days the user will have to sign into
      // DigitalOcean again. Note we cannot yet use DigitalOcean refresh
      // tokens, as they require a client_secret to be stored on a server and
      // not visible to end users in client-side JS. More details at:
      // https://developers.digitalocean.com/documentation/oauth/#refresh-token-flow
      return await oauth.result;
    } catch (error) {
      if (oauth.isCancelled()) {
        throw CANCELLED_ERROR;
      } else {
        throw error;
      }
    }
  }

  // Runs the GCP OAuth flow and returns the API refresh token (which can be
  // exchanged for an access token).
  // Throws CANCELLED_ERROR on cancellation, or the error in case of failure.
  private async runGcpOauthFlow(): Promise<string> {
    const oauth = runGcpOauth();
    const handleOauthFlowCancelled = () => {
      oauth.cancel();
      this.disconnectGcpAccount();
      this.showIntro();
    };
    this.appRoot.getAndShowGcpOauthFlow(handleOauthFlowCancelled);
    try {
      return await oauth.result;
    } catch (error) {
      if (oauth.isCancelled()) {
        throw CANCELLED_ERROR;
      } else {
        throw error;
      }
    }
  }

  private async handleConnectDigitalOceanAccountRequest(): Promise<void> {
    let digitalOceanAccount: digitalocean.Account = null;
    try {
      const accessToken = await this.runDigitalOceanOauthFlow();
      bringToFront();
      digitalOceanAccount =
        this.cloudAccounts.connectDigitalOceanAccount(accessToken);
    } catch (error) {
      this.disconnectDigitalOceanAccount();
      this.showIntro();
      bringToFront();
      if (error !== CANCELLED_ERROR) {
        console.error(`DigitalOcean authentication failed: ${error}`);
        this.appRoot.showError(this.appRoot.localize('error-do-auth'));
      }
      return;
    }

    const doServers = await this.loadDigitalOceanAccount(digitalOceanAccount);
    if (doServers.length > 0) {
      this.showServer(doServers[0]);
    } else {
      await this.showDigitalOceanCreateServer(this.digitalOceanAccount);
    }
  }

  private async handleConnectGcpAccountRequest(): Promise<void> {
    let gcpAccount: gcp.Account = null;
    try {
      const refreshToken = await this.runGcpOauthFlow();
      bringToFront();
      gcpAccount = this.cloudAccounts.connectGcpAccount(refreshToken);
    } catch (error) {
      this.disconnectGcpAccount();
      this.showIntro();
      bringToFront();
      if (error !== CANCELLED_ERROR) {
        console.error(`GCP authentication failed: ${error}`);
        this.appRoot.showError(this.appRoot.localize('error-gcp-auth'));
      }
      return;
    }

    const gcpServers = await this.loadGcpAccount(gcpAccount);
    if (gcpServers.length > 0) {
      this.showServer(gcpServers[0]);
    } else {
      this.appRoot.getAndShowGcpCreateServerApp().start(this.gcpAccount);
    }
  }

  // Clears the DigitalOcean credentials and returns to the intro screen.
  private disconnectDigitalOceanAccount(): void {
    if (!this.digitalOceanAccount) {
      // Not connected.
      return;
    }
    const accountId = this.digitalOceanAccount.getId();
    this.cloudAccounts.disconnectDigitalOceanAccount();
    this.digitalOceanAccount = null;
    for (const serverEntry of this.appRoot.serverList) {
      if (serverEntry.accountId === accountId) {
        this.removeServer(serverEntry.id);
      }
    }
    this.appRoot.digitalOceanAccount = null;
  }

  // Clears the GCP credentials and returns to the intro screen.
  private disconnectGcpAccount(): void {
    if (!this.gcpAccount) {
      // Not connected.
      return;
    }
    const accountId = this.gcpAccount.getId();
    this.cloudAccounts.disconnectGcpAccount();
    this.gcpAccount = null;
    for (const serverEntry of this.appRoot.serverList) {
      if (serverEntry.accountId === accountId) {
        this.removeServer(serverEntry.id);
      }
    }
    this.appRoot.gcpAccount = null;
  }

  // Opens the screen to create a server.
  private async showDigitalOceanCreateServer(
    digitalOceanAccount: digitalocean.Account
  ): Promise<void> {
    try {
      await this.ensureActiveDigitalOceanAccount(digitalOceanAccount);
    } catch (error) {
      if (this.appRoot.currentPage === 'digitalOceanOauth') {
        this.showIntro();
      }
      if (error !== CANCELLED_ERROR) {
        console.error('Failed to validate DigitalOcean account', error);
        this.appRoot.showError(this.appRoot.localize('error-do-account-info'));
      }
      return;
    }

    try {
      const status = await digitalOceanAccount.getStatus();
      if (status.hasReachedLimit) {
        this.appRoot.showError(
          this.appRoot.localize('error-do-limit', 'num', status.dropletLimit)
        );
        return; // Don't proceed to the region picker.
      }
    } catch (e) {
      console.error('Failed to check droplet limit status', e);
    }

    try {
      const regionPicker = this.appRoot.getAndShowRegionPicker();
      const map = await this.digitalOceanRetry(() => {
        return this.digitalOceanAccount.listLocations();
      });
      regionPicker.options = sortOptions(
        filterOptions(map),
        this.appRoot.localize as (id: string) => string,
        this.appRoot.language
      );
    } catch (e) {
      console.error(`Failed to get list of available regions: ${e}`);
      this.appRoot.showError(this.appRoot.localize('error-do-regions'));
    }
  }

  // Returns a promise which fulfills once the DigitalOcean droplet is created.
  // Shadowbox may not be fully installed once this promise is fulfilled.
  async createDigitalOceanServer(
    region: digitalocean.Region,
    metricsEnabled: boolean
  ): Promise<void> {
    try {
      const serverName = this.makeLocalizedServerName(region);
      const server = await this.digitalOceanRetry(() => {
        return this.digitalOceanAccount.createServer(
          region,
          serverName,
          metricsEnabled
        );
      });
      this.addServer(this.digitalOceanAccount.getId(), server);
      this.showServer(server);
    } catch (error) {
      console.error('Error from createDigitalOceanServer', error);
      this.appRoot.showError(this.appRoot.localize('error-server-creation'));
    }
  }

  private makeLocalizedServerName(cloudLocation: CloudLocation): string {
    const placeName = getShortName(
      cloudLocation,
      this.appRoot.localize as (id: string) => string
    );
    return this.appRoot.localize('server-name', 'serverLocation', placeName);
  }

  public showServer(server: server_model.Server): void {
    this.selectedServer = server;
    this.appRoot.selectedServerId = server.getId();
    localStorage.setItem(LAST_DISPLAYED_SERVER_STORAGE_KEY, server.getId());
    this.appRoot.showServerView();
  }

  private async updateServerView(server: server_model.Server): Promise<void> {
    if (await server.isHealthy()) {
      this.setServerManagementView(server);
    } else {
      this.setServerUnreachableView(server);
    }
  }

  // Show the server management screen. Assumes the server is healthy.
  private async setServerManagementView(
    server: server_model.Server
  ): Promise<void> {
    // Show view and initialize fields from selectedServer.
    const view = await this.appRoot.getServerView(server.getId());
    const version = server.getVersion();
    view.selectedPage = 'managementView';
    view.metricsId = server.getMetricsId();
    view.serverHostname = server.getHostnameForAccessKeys();
    view.serverManagementApiUrl = server.getManagementApiUrl();
    view.serverPortForNewAccessKeys = server.getPortForNewAccessKeys();
    view.serverCreationDate = server.getCreatedDate();
    view.serverVersion = version;
    view.defaultDataLimitBytes = server.getDefaultDataLimit()?.bytes;
    view.isDefaultDataLimitEnabled = view.defaultDataLimitBytes !== undefined;
    view.showFeatureMetricsDisclaimer =
      server.getMetricsEnabled() &&
      !server.getDefaultDataLimit() &&
      !hasSeenFeatureMetricsNotification();

    if (semver.valid(version)) {
      view.isAccessKeyPortEditable = semver.gte(
        version,
        CHANGE_KEYS_PORT_VERSION
      );
      view.supportsDefaultDataLimit = semver.gte(version, DATA_LIMITS_VERSION);
      view.isHostnameEditable = semver.gte(version, CHANGE_HOSTNAME_VERSION);
      view.hasPerKeyDataLimitDialog = semver.gte(version, KEY_SETTINGS_VERSION);
    }

    if (isManagedServer(server)) {
      const host = server.getHost();
      view.monthlyCost = host.getMonthlyCost()?.usd;
      view.monthlyOutboundTransferBytes =
        host.getMonthlyOutboundTransferLimit()?.terabytes * 10 ** 12;
      view.cloudLocation = host.getCloudLocation();
    }

    view.metricsEnabled = server.getMetricsEnabled();

    // Asynchronously load "My Connection" and other access keys in order to not block showing the
    // server.
    setTimeout(async () => {
      this.showMetricsOptInWhenNeeded(server);
      try {
        const serverAccessKeys = await server.listAccessKeys();
        if (view.defaultDataLimitBytes === undefined) {
          view.defaultDataLimitBytes = (
            await computeDefaultDataLimit(server, serverAccessKeys)
          )?.bytes;
        }
        await this.refreshServerMetricsUI(server, view);

        // Show help bubbles once the page has rendered.
        setTimeout(() => {
          showHelpBubblesOnce(view);
        }, 250);
      } catch (error) {
        console.error(`Failed to load access keys: ${error}`);
        this.appRoot.showError(this.appRoot.localize('error-keys-get'));
      }
      this.showServerMetrics(server, view);
    }, 0);
  }

  private async setServerUnreachableView(
    server: server_model.Server
  ): Promise<void> {
    // Display the unreachable server state within the server view.
    const serverId = server.getId();
    const serverView = await this.appRoot.getServerView(serverId);
    serverView.selectedPage = 'unreachableView';
    serverView.retryDisplayingServer = async () => {
      await this.updateServerView(server);
    };
  }

  private async setServerProgressView(
    server: server_model.ManagedServer
  ): Promise<void> {
    const view = await this.appRoot.getServerView(server.getId());
    view.serverName = this.makeDisplayName(server);
    view.selectedPage = 'progressView';
    try {
      for await (view.installProgress of server.monitorInstallProgress()) {
        /* empty */
      }
    } catch {
      // Ignore any errors; they will be handled by `this.addServer`.
    }
  }

  private showMetricsOptInWhenNeeded(selectedServer: server_model.Server) {
    const showMetricsOptInOnce = () => {
      // Sanity check to make sure the running server is still displayed, i.e.
      // it hasn't been deleted.
      if (this.selectedServer !== selectedServer) {
        return;
      }
      // Show the metrics opt in prompt if the server has not already opted in,
      // and if they haven't seen the prompt yet according to localStorage.
      const storageKey =
        selectedServer.getMetricsId() + '-prompted-for-metrics';
      if (
        !selectedServer.getMetricsEnabled() &&
        !localStorage.getItem(storageKey)
      ) {
        this.appRoot.showMetricsDialogForNewServer();
        localStorage.setItem(storageKey, 'true');
      }
    };

    // Calculate milliseconds passed since server creation.
    const createdDate = selectedServer.getCreatedDate();
    const now = new Date();
    const msSinceCreation = now.getTime() - createdDate.getTime();

    // Show metrics opt-in once ONE_DAY_IN_MS has passed since server creation.
    const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
    if (msSinceCreation >= ONE_DAY_IN_MS) {
      showMetricsOptInOnce();
    } else {
      setTimeout(showMetricsOptInOnce, ONE_DAY_IN_MS - msSinceCreation);
    }
  }

  private async refreshServerMetricsUI(
    selectedServer: server_model.Server,
    serverView: ServerView
  ) {
    try {
      const serverAccessKeysPromise = selectedServer.listAccessKeys();
      const serverMetricsPromise = selectedServer.getServerMetrics();

      // Preload an incomplete access key table UI based on the much faster list access key endpoint:
      const serverAccessKeys = await serverAccessKeysPromise;

      // (only do this if there's currently no data at all)
      if (!serverView.hasAccessKeyData) {
        this.refreshAccessKeyTableUI(serverView, serverAccessKeys);
      }

      // Now load the full server metrics object (slow):
      const serverMetrics = await serverMetricsPromise;

      if (!serverMetrics.server) {
        serverView.serverMetricsData = {
          dataTransferred: {
            bytes: 0,
          },
        };

        for (const key of serverMetrics.accessKeys) {
          serverView.serverMetricsData.dataTransferred.bytes +=
            key.dataTransferred.bytes;
        }

        serverView.serverMetricsBandwidthLocations = [];
        serverView.serverMetricsTunnelTimeLocations = [];
      } else {
        serverView.serverMetricsData = {
          bandwidth: serverMetrics.server.bandwidth,
          dataTransferred: serverMetrics.server.dataTransferred,
          tunnelTime: serverMetrics.server.tunnelTime,
        };

        const NUMBER_OF_ASES_TO_SHOW = 4;
        serverView.serverMetricsBandwidthLocations =
          serverMetrics.server.locations
            .sort(
              (location2, location1) =>
                location1.dataTransferred?.bytes -
                location2.dataTransferred?.bytes
            )
            .slice(0, NUMBER_OF_ASES_TO_SHOW)
            .map(location => ({
              ...location,
              asn: `AS${location.asn}`,
              countryFlag: this.countryCodeToEmoji(location.location),
              bytes: location.dataTransferred.bytes,
            }));

        serverView.serverMetricsTunnelTimeLocations =
          serverMetrics.server.locations
            .sort(
              (location2, location1) =>
                location1.tunnelTime?.seconds - location2.tunnelTime?.seconds
            )
            .slice(0, NUMBER_OF_ASES_TO_SHOW)
            .map(location => ({
              ...location,
              asn: `AS${location.asn}`,
              countryFlag: this.countryCodeToEmoji(location.location),
              seconds: location.tunnelTime.seconds,
            }));
      }

      // Join the server metrics data with the previous access key information
      // now that we've populated the accessKeyMetricsIndex:
      const accessKeyMetricsIndex: Map<string, server_model.AccessKeyMetrics> =
        new Map();

      for (const accessKey of serverMetrics.accessKeys) {
        accessKeyMetricsIndex.set(accessKey.accessKeyId, accessKey);
      }

      this.refreshAccessKeyTableUI(
        serverView,
        serverAccessKeys,
        accessKeyMetricsIndex
      );

      serverView.hasServerMetricsData = true;
    } catch (e) {
      // Since failures are invisible to users we generally want exceptions here to bubble
      // up and trigger a Sentry report. The exception is network errors, about which we can't
      // do much (note: ShadowboxServer generates a breadcrumb for failures regardless which
      // will show up when someone explicitly submits feedback).
      // TODO(fortuna): the model is leaking implementation details here. We should clean this up
      // Perhaps take a more event-based approach.
      if (e instanceof path_api.ServerApiError && e.isNetworkError()) {
        return;
      }
      throw e;
    }
  }

  private refreshAccessKeyTableUI(
    serverView: ServerView,
    serverAccessKeys: server_model.AccessKey[],
    accessKeyMetricsIndex?: Map<string, server_model.AccessKeyMetrics>
  ) {
    serverView.accessKeyData = serverAccessKeys.map(accessKey => {
      const accessKeyMetrics = accessKeyMetricsIndex?.get(accessKey.id);

      const resolveKeyName = (key: server_model.AccessKey) =>
        key.name || this.appRoot.localize('key', 'keyId', key.id);

      let dataLimit = accessKey.dataLimit;
      if (!dataLimit && serverView.isDefaultDataLimitEnabled) {
        dataLimit = {
          bytes: serverView.defaultDataLimitBytes,
        };
      }

      if (!accessKeyMetrics) {
        return {
          ...accessKey,
          name: resolveKeyName(accessKey),
          isOnline: false,
          dataTransferred: {
            bytes: 0,
          },
          dataLimit,
        };
      }

      let isOnline = false;
      if (accessKeyMetrics.connection) {
        isOnline =
          accessKeyMetrics.connection.lastTrafficSeen >=
          new Date(Date.now() - 5 * MINUTES_TO_MILLISECONDS);
      }

      return {
        ...accessKey,
        ...accessKeyMetrics,
        name: resolveKeyName(accessKey),
        isOnline,
        dataLimit,
      };
    });

    serverView.hasAccessKeyData = true;
  }

  private countryCodeToEmoji(countryCode: string) {
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      return '';
    }

    // Convert the country code to an emoji using Unicode regional indicator symbols
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => CHARACTER_TABLE_FLAG_SYMBOL_OFFSET + char.charCodeAt(0));

    return String.fromCodePoint(...codePoints);
  }

  private showServerMetrics(
    selectedServer: server_model.Server,
    serverView: ServerView
  ) {
    this.refreshServerMetricsUI(selectedServer, serverView);
    // Get transfer stats once per minute for as long as server is selected.
    const statsRefreshRateMs = 60 * 1000;
    const intervalId = setInterval(() => {
      if (this.selectedServer !== selectedServer) {
        // Server is no longer running, stop interval
        clearInterval(intervalId);
        return;
      }
      this.refreshServerMetricsUI(selectedServer, serverView);
    }, statsRefreshRateMs);
  }

  private async addAccessKey() {
    const server = this.selectedServer;
    try {
      await server.addAccessKey();
      const serverView = await this.appRoot.getServerView(server.getId());
      this.refreshServerMetricsUI(server, serverView);
      this.appRoot.showNotification(
        this.appRoot.localize('notification-key-added')
      );
    } catch (error) {
      console.error(`Failed to add access key: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-key-add'));
    }
  }

  private async renameAccessKey(accessKeyId: string, newName: string) {
    try {
      await this.selectedServer.renameAccessKey(accessKeyId, newName);
    } catch (error) {
      console.error(`Failed to rename access key: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-key-rename'));
    } finally {
      this.refreshServerMetricsUI(
        this.selectedServer,
        await this.appRoot.getServerView(this.selectedServer.getId())
      );
    }
  }

  private async setDefaultDataLimit(limit: server_model.Data) {
    if (!limit) {
      return;
    }
    const previousLimit = this.selectedServer.getDefaultDataLimit();
    if (previousLimit && limit.bytes === previousLimit.bytes) {
      return;
    }
    const serverView = await this.appRoot.getServerView(
      this.appRoot.selectedServerId
    );
    try {
      await this.selectedServer.setDefaultDataLimit(limit);
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      serverView.defaultDataLimitBytes = limit?.bytes;
      serverView.isDefaultDataLimitEnabled = true;
      this.refreshServerMetricsUI(this.selectedServer, serverView);
      // Don't display the feature collection disclaimer anymore.
      serverView.showFeatureMetricsDisclaimer = false;
      window.localStorage.setItem(
        'dataLimits-feature-collection-notification',
        'true'
      );
    } catch (error) {
      console.error(`Failed to set server default data limit: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-set-data-limit'));
      const defaultLimit =
        previousLimit || (await computeDefaultDataLimit(this.selectedServer));
      serverView.defaultDataLimitBytes = defaultLimit?.bytes;
      serverView.isDefaultDataLimitEnabled = !!previousLimit;
    }
  }

  private async removeDefaultDataLimit() {
    const serverView = await this.appRoot.getServerView(
      this.appRoot.selectedServerId
    );
    const previousLimit = this.selectedServer.getDefaultDataLimit();
    try {
      await this.selectedServer.removeDefaultDataLimit();
      serverView.isDefaultDataLimitEnabled = false;
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      this.refreshServerMetricsUI(this.selectedServer, serverView);
    } catch (error) {
      console.error(`Failed to remove server default data limit: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-remove-data-limit'));
      serverView.isDefaultDataLimitEnabled = !!previousLimit;
    }
  }

  private openPerKeyDataLimitDialog(
    event: CustomEvent<{
      keyId: string;
      keyDataLimitBytes: number | undefined;
      keyName: string;
      serverId: string;
      defaultDataLimitBytes: number | undefined;
    }>
  ) {
    const detail = event.detail;
    const onDataLimitSet = this.savePerKeyDataLimit.bind(
      this,
      detail.serverId,
      detail.keyId
    );
    const onDataLimitRemoved = this.removePerKeyDataLimit.bind(
      this,
      detail.serverId,
      detail.keyId
    );
    const activeDataLimitBytes =
      detail.keyDataLimitBytes ?? detail.defaultDataLimitBytes;
    this.appRoot.openPerKeyDataLimitDialog(
      detail.keyName,
      activeDataLimitBytes,
      onDataLimitSet,
      onDataLimitRemoved
    );
  }

  private async savePerKeyDataLimit(
    serverId: string,
    keyId: string,
    dataLimitBytes: number
  ): Promise<boolean> {
    this.appRoot.showNotification(this.appRoot.localize('saving'));
    const server = this.idServerMap.get(serverId);
    const serverView = await this.appRoot.getServerView(server.getId());
    try {
      await server.setAccessKeyDataLimit(keyId, {bytes: dataLimitBytes});
      this.refreshServerMetricsUI(server, serverView);
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      return true;
    } catch (error) {
      console.error(
        `Failed to set data limit for access key ${keyId}: ${error}`
      );
      this.appRoot.showError(this.appRoot.localize('error-set-per-key-limit'));
      return false;
    }
  }

  private async removePerKeyDataLimit(
    serverId: string,
    keyId: string
  ): Promise<boolean> {
    this.appRoot.showNotification(this.appRoot.localize('saving'));
    const server = this.idServerMap.get(serverId);
    const serverView = await this.appRoot.getServerView(server.getId());
    try {
      await server.removeAccessKeyDataLimit(keyId);
      this.refreshServerMetricsUI(server, serverView);
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      return true;
    } catch (error) {
      console.error(
        `Failed to remove data limit from access key ${keyId}: ${error}`
      );
      this.appRoot.showError(
        this.appRoot.localize('error-remove-per-key-limit')
      );
      return false;
    }
  }

  private async setHostnameForAccessKeys(
    hostname: string,
    serverSettings: polymer.Base
  ) {
    this.appRoot.showNotification(this.appRoot.localize('saving'));
    try {
      await this.selectedServer.setHostnameForAccessKeys(hostname);
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      serverSettings.enterSavedState();
    } catch (error) {
      this.appRoot.showError(this.appRoot.localize('error-not-saved'));
      if (error.isNetworkError()) {
        serverSettings.enterErrorState(this.appRoot.localize('error-network'));
        return;
      }
      const message =
        error.response.status === 400
          ? 'error-hostname-invalid'
          : 'error-unexpected';
      serverSettings.enterErrorState(this.appRoot.localize(message));
    }
  }

  private async setPortForNewAccessKeys(
    port: number,
    serverSettings: polymer.Base
  ) {
    this.appRoot.showNotification(this.appRoot.localize('saving'));
    try {
      await this.selectedServer.setPortForNewAccessKeys(port);
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      serverSettings.enterSavedState();
    } catch (error) {
      this.appRoot.showError(this.appRoot.localize('error-not-saved'));
      if (error.isNetworkError()) {
        serverSettings.enterErrorState(this.appRoot.localize('error-network'));
        return;
      }
      const code = error.response.status;
      if (code === 409) {
        serverSettings.enterErrorState(
          this.appRoot.localize('error-keys-port-in-use')
        );
        return;
      }
      serverSettings.enterErrorState(this.appRoot.localize('error-unexpected'));
    }
  }

  // Returns promise which fulfills when the server is created successfully,
  // or rejects with an error message that can be displayed to the user.
  public async createManualServer(userInput: string): Promise<void> {
    let serverConfig: server_model.ManualServerConfig;
    try {
      serverConfig = parseManualServerConfig(userInput);
    } catch (e) {
      // This shouldn't happen because the UI validates the URL before enabling the DONE button.
      const msg = `could not parse server config: ${e.message}`;
      console.error(msg);
      throw new Error(msg);
    }

    // Don't let `ManualServerRepository.addServer` throw to avoid redundant error handling if we
    // are adding an existing server. Query the repository instead to treat the UI accordingly.
    const storedServer = this.manualServerRepository.findServer(serverConfig);
    if (storedServer) {
      this.appRoot.showNotification(
        this.appRoot.localize('notification-server-exists'),
        5000
      );
      this.showServer(storedServer);
      return;
    }
    const manualServer =
      await this.manualServerRepository.addServer(serverConfig);
    if (await manualServer.isHealthy()) {
      this.addServer(null, manualServer);
      this.showServer(manualServer);
    } else {
      // Remove inaccessible manual server from local storage if it was just created.
      manualServer.forget();
      console.error('Manual server installed but unreachable.');
      throw new UnreachableServerError();
    }
  }

  private async removeAccessKey(accessKeyId: string) {
    const server = this.selectedServer;
    try {
      await server.removeAccessKey(accessKeyId);
      this.refreshServerMetricsUI(
        server,
        await this.appRoot.getServerView(server.getId())
      );
      this.appRoot.showNotification(
        this.appRoot.localize('notification-key-removed')
      );
    } catch (error) {
      console.error(`Failed to remove access key: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-key-remove'));
    }
  }

  private deleteServer(serverId: string) {
    const serverToDelete = this.getServerById(serverId);
    if (!isManagedServer(serverToDelete)) {
      const msg = 'cannot delete non-ManagedServer';
      console.error(msg);
      throw new Error(msg);
    }

    const confirmationTitle = this.appRoot.localize(
      'confirmation-server-destroy-title'
    );
    const confirmationText = this.appRoot.localize(
      'confirmation-server-destroy'
    );
    const confirmationButton = this.appRoot.localize('destroy');
    this.appRoot.getConfirmation(
      confirmationTitle,
      confirmationText,
      confirmationButton,
      () => {
        this.digitalOceanRetry(() => {
          // TODO: Add an activity indicator in OutlineServerView during deletion.
          return serverToDelete.getHost().delete();
        }).then(
          () => {
            this.removeServer(serverId);
            this.showIntro();
            this.appRoot.showNotification(
              this.appRoot.localize('notification-server-destroyed')
            );
          },
          e => {
            // Don't show a toast on the login screen.
            if (!(e instanceof digitalocean_api.XhrError)) {
              console.error(`Failed destroy server: ${e}`);
              this.appRoot.showError(
                this.appRoot.localize('error-server-destroy')
              );
            }
          }
        );
      }
    );
  }

  private forgetServer(serverId: string) {
    const serverToForget = this.getServerById(serverId);
    if (!isManualServer(serverToForget)) {
      const msg = 'cannot forget non-ManualServer';
      console.error(msg);
      throw new Error(msg);
    }
    const confirmationTitle = this.appRoot.localize(
      'confirmation-server-remove-title'
    );
    const confirmationText = this.appRoot.localize(
      'confirmation-server-remove'
    );
    const confirmationButton = this.appRoot.localize('remove');
    this.appRoot.getConfirmation(
      confirmationTitle,
      confirmationText,
      confirmationButton,
      () => {
        serverToForget.forget();
        this.removeServer(serverId);
        this.showIntro();
        this.appRoot.showNotification(
          this.appRoot.localize('notification-server-removed')
        );
      }
    );
  }

  private async setMetricsEnabled(metricsEnabled: boolean) {
    const serverView = await this.appRoot.getServerView(
      this.appRoot.selectedServerId
    );
    try {
      await this.selectedServer.setMetricsEnabled(metricsEnabled);
      this.appRoot.showNotification(this.appRoot.localize('saved'));
      // Change metricsEnabled property on polymer element to update display.
      serverView.metricsEnabled = metricsEnabled;
    } catch (error) {
      console.error(`Failed to set metrics enabled: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-metrics'));
      serverView.metricsEnabled = !metricsEnabled;
    }
  }

  private async renameServer(newName: string) {
    const serverToRename = this.selectedServer;
    const serverId = this.appRoot.selectedServerId;
    const view = await this.appRoot.getServerView(serverId);
    try {
      await serverToRename.setName(newName);
      view.serverName = newName;
      this.updateServerEntry(serverToRename);
    } catch (error) {
      console.error(`Failed to rename server: ${error}`);
      this.appRoot.showError(this.appRoot.localize('error-server-rename'));
      const oldName = this.selectedServer.getName();
      view.serverName = oldName;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (view.$.serverSettings as any).serverName = oldName;
    }
  }

  private cancelServerCreation(serverToCancel: server_model.Server): void {
    if (!isManagedServer(serverToCancel)) {
      const msg = 'cannot cancel non-ManagedServer';
      console.error(msg);
      throw new Error(msg);
    }
    // TODO: Make the cancel button show an immediate state transition,
    // indicate that deletion is in-progress, and allow the user to return
    // to server creation in the meantime.
    serverToCancel
      .getHost()
      .delete()
      .then(() => {
        this.removeServer(serverToCancel.getId());
        this.showIntro();
      });
  }

  private async setAppLanguage(
    languageCode: string,
    languageDir: 'rtl' | 'ltr'
  ) {
    try {
      await this.appRoot.setLanguage(languageCode, languageDir);
      document.documentElement.setAttribute('dir', languageDir);
      window.localStorage.setItem('overrideLanguage', languageCode);
    } catch {
      this.appRoot.showError(this.appRoot.localize('error-unexpected'));
    }
  }
}
