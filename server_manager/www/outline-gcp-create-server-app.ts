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

import '@polymer/paper-dropdown-menu/paper-dropdown-menu';
import '@polymer/paper-listbox/paper-listbox';
import '@polymer/paper-input/paper-input';
import '@polymer/paper-item/paper-item';

import './ui_components/outline-step-view';
import './ui_components/outline-region-picker-step';

import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import {GcpAccount, isInFreeTier} from './gcp_account';
import {filterOptions, getShortName, sortOptions} from './location_formatting';
import {AppRoot} from './ui_components/app-root';
import {COMMON_STYLES} from './ui_components/cloud-install-styles';
import {OutlineRegionPicker} from './ui_components/outline-region-picker-step';
import {BillingAccount, Project, Zone, Account} from '../model/gcp';
import {CloudLocation} from '../model/location';

@customElement('outline-gcp-create-server-app')
export class GcpCreateServerApp extends LitElement {
  @property({type: Function}) localize: (
    msgId: string,
    ...params: string[]
  ) => string;
  @property({type: String}) language: string;
  @state() private currentPage = '';
  @state() private selectedProjectId = '';
  @state() private selectedBillingAccountId = '';
  @state() private isProjectBeingCreated = false;

  private account: GcpAccount;
  private project: Project;
  private billingAccounts: BillingAccount[] = [];
  private regionPicker: OutlineRegionPicker;
  private billingAccountsRefreshLoop: number = null;

  static get styles() {
    return [
      COMMON_STYLES,
      css`
        :host {
          --paper-input-container-input-color: var(--medium-gray);
        }
        .container {
          display: flex;
          flex-direction: column;
          justify-content: center;
          height: 100%;
          align-items: center;
          padding: 156px 0;
          font-size: 14px;
        }
        .card {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: space-between;
          margin: 24px 0;
          background: var(--background-contrast-color);
          box-shadow:
            0 0 2px 0 rgba(0, 0, 0, 0.14),
            0 2px 2px 0 rgba(0, 0, 0, 0.12),
            0 1px 3px 0 rgba(0, 0, 0, 0.2);
          border-radius: 2px;
        }
        .section {
          padding: 24px 12px;
          color: var(--light-gray);
          background: var(--background-contrast-color);
          border-radius: 2px;
        }
        .section:not(:first-child) {
          margin-top: 8px;
        }
        .section-header {
          padding: 0 6px 0;
          display: flex;
        }
        .section-content {
          padding: 0 48px;
        }
        .instructions {
          font-size: 16px;
          line-height: 26px;
          margin-left: 16px;
          flex: 2;
        }
        .stepcircle {
          height: 26px;
          width: 26px;
          font-size: 14px;
          border-radius: 50%;
          float: left;
          vertical-align: middle;
          color: #000;
          background-color: #fff;
          margin: auto;
          text-align: center;
          line-height: 26px;
        }
        @media (min-width: 1025px) {
          paper-card {
            /* Set min with for the paper-card to grow responsively. */
            min-width: 600px;
          }
        }
        .card p {
          color: var(--light-gray);
          width: 100%;
          text-align: center;
        }
        #projectName {
          width: 250px;
        }
        #billingAccount {
          width: 250px;
        }
        paper-button {
          background: var(--primary-green);
          color: var(--light-gray);
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 2px;
        }
        paper-button[disabled] {
          color: var(--medium-gray);
          background: transparent;
        }
      `,
    ];
  }

  render() {
    switch (this.currentPage) {
      case 'billingAccountSetup':
        return this.renderBillingAccountSetup();
      case 'projectSetup':
        return this.renderProjectSetup();
      case 'regionPicker':
        return this.renderRegionPicker();
      default:
    }
  }

  private renderBillingAccountSetup() {
    const openLink = '<a href="https://console.cloud.google.com/billing">';
    const closeLink = '</a>';
    return html` <outline-step-view id="billingAccountSetup" display-action="">
      <span slot="step-title">${this.localize('gcp-billing-title')}</span>
      <span slot="step-description">
        ${unsafeHTML(
          this.localize(
            'gcp-billing-description',
            'openLink',
            openLink,
            'closeLink',
            closeLink
          )
        )}
      </span>
      <span slot="step-action">
        <paper-button
          id="billingPageAction"
          @tap="${this.handleBillingVerificationNextTap}"
        >
          ${this.localize('gcp-billing-action')}
        </paper-button>
      </span>
      <paper-card class="card">
        <div class="container">
          <img src="images/do_oauth_billing.svg" />
          <p>
            ${unsafeHTML(
              this.localize(
                'gcp-billing-body',
                'openLink',
                openLink,
                'closeLink',
                closeLink
              )
            )}
          </p>
        </div>
        <paper-progress indeterminate></paper-progress>
      </paper-card>
    </outline-step-view>`;
  }

  private renderProjectSetup() {
    return html` <outline-step-view id="projectSetup" display-action="">
      <span slot="step-title">Create your Google Cloud Platform project.</span>
      <span slot="step-description"
        >This will create a new project on your GCP account to hold your Outline
        servers.</span
      >
      <span slot="step-action">
        ${this.isProjectBeingCreated
          ? // TODO: Support canceling server creation.
            html`<paper-button disabled="true">IN PROGRESS...</paper-button>`
          : html`<paper-button
              id="createServerButton"
              @tap="${this.handleProjectSetupNextTap}"
              ?disabled="${!this.isProjectSetupNextEnabled(
                this.selectedProjectId,
                this.selectedBillingAccountId
              )}"
            >
              CREATE PROJECT
            </paper-button>`}
      </span>
      <div class="section">
        <div class="section-header">
          <span class="stepcircle">1</span>
          <div class="instructions">Name your new Google Cloud Project</div>
        </div>
        <div class="section-content">
          <!-- TODO: Make readonly if project already exists -->
          <paper-input
            id="projectName"
            value="${this.selectedProjectId}"
            label="Project ID"
            always-float-label=""
            maxlength="100"
            @value-changed="${this.onProjectIdChanged}"
          ></paper-input>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="stepcircle">2</span>
          <div class="instructions">
            Choose your preferred billing method for this project
          </div>
        </div>
        <div class="section-content">
          <paper-dropdown-menu
            id="billingAccount"
            no-label-float=""
            horizontal-align="left"
          >
            <paper-listbox
              slot="dropdown-content"
              selected="${this.selectedBillingAccountId}"
              attr-for-selected="name"
              @selected-changed="${this.onBillingAccountSelected}"
            >
              ${this.billingAccounts.map(billingAccount => {
                return html`<paper-item name="${billingAccount.id}"
                  >${billingAccount.name}</paper-item
                >`;
              })}
            </paper-listbox>
          </paper-dropdown-menu>
        </div>
      </div>
      ${this.isProjectBeingCreated
        ? html`<paper-progress indeterminate="" class="slow"></paper-progress>`
        : ''}
    </outline-step-view>`;
  }

  private renderRegionPicker() {
    return html` <outline-region-picker-step
      id="regionPicker"
      .localize=${this.localize}
      .language=${this.language}
      @RegionSelected="${this.onRegionSelected}"
    >
    </outline-region-picker-step>`;
  }

  async start(account: Account): Promise<void> {
    this.init();
    this.account = account as GcpAccount;

    try {
      this.billingAccounts = await this.account.listOpenBillingAccounts();
      const projects = await this.account.listProjects();
      // TODO: We don't support multiple projects atm, but we will want to allow
      // the user to choose the appropriate one.
      this.project = projects?.[0];
    } catch (e) {
      // TODO: Surface this error to the user.
      console.warn('Error fetching GCP account info', e);
    }
    if (await this.isProjectHealthy()) {
      this.showRegionPicker();
    } else if (!(this.billingAccounts?.length > 0)) {
      this.showBillingAccountSetup();
      // Check every five seconds to see if an account has been added.
      this.billingAccountsRefreshLoop = window.setInterval(() => {
        try {
          this.refreshBillingAccounts();
        } catch (e) {
          console.warn('Billing account refresh error', e);
        }
      }, 5000);
    } else {
      this.showProjectSetup(this.project);
    }
  }

  private async isProjectHealthy(): Promise<boolean> {
    return this.project
      ? await this.account.isProjectHealthy(this.project.id)
      : false;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopRefreshingBillingAccounts();
  }

  private init() {
    this.currentPage = '';
    this.selectedProjectId = '';
    this.selectedBillingAccountId = '';
    this.stopRefreshingBillingAccounts();
  }

  private showBillingAccountSetup(): void {
    this.currentPage = 'billingAccountSetup';
  }

  private async refreshBillingAccounts(): Promise<void> {
    this.billingAccounts = await this.account.listOpenBillingAccounts();

    if (this.billingAccounts?.length > 0) {
      this.stopRefreshingBillingAccounts();
      if (await this.isProjectHealthy()) {
        this.showRegionPicker();
      } else {
        this.showProjectSetup(this.project);
      }
      bringToFront();
    }
  }

  public stopRefreshingBillingAccounts(): void {
    window.clearInterval(this.billingAccountsRefreshLoop);
    this.billingAccountsRefreshLoop = null;
  }

  private showError(message: string) {
    const appRoot: AppRoot = document.getElementById('appRoot') as AppRoot;
    appRoot.showError(message);
  }

  private async handleBillingVerificationNextTap(): Promise<void> {
    try {
      await this.refreshBillingAccounts();
    } catch {
      this.showError(this.localize('gcp-billing-error'));
    }
    if (this.billingAccounts?.length > 0) {
      await this.showProjectSetup();
    } else {
      this.showError(this.localize('gcp-billing-error-zero'));
    }
  }

  private async showProjectSetup(existingProject?: Project): Promise<void> {
    this.project = existingProject ?? null;
    this.selectedProjectId = this.project?.id ?? this.makeProjectName();
    this.selectedBillingAccountId = this.billingAccounts[0].id;
    this.currentPage = 'projectSetup';
  }

  private isProjectSetupNextEnabled(
    projectId: string,
    billingAccountId: string
  ): boolean {
    // TODO: Proper validation
    return projectId !== '' && billingAccountId !== '';
  }

  private async handleProjectSetupNextTap(): Promise<void> {
    this.isProjectBeingCreated = true;
    try {
      if (!this.project) {
        this.project = await this.account.createProject(
          this.selectedProjectId,
          this.selectedBillingAccountId
        );
      } else {
        await this.account.repairProject(
          this.project.id,
          this.selectedBillingAccountId
        );
      }
      this.showRegionPicker();
    } catch (e) {
      this.showError(this.localize('gcp-project-setup-error'));
      console.warn('Project setup failed:', e);
    }
    this.isProjectBeingCreated = false;
  }

  private async showRegionPicker(): Promise<void> {
    const isProjectHealthy = await this.account.isProjectHealthy(
      this.project.id
    );
    if (!isProjectHealthy) {
      return this.showProjectSetup();
    }

    this.currentPage = 'regionPicker';
    const zoneOptions = await this.account.listLocations(this.project.id);
    // Note: This relies on a side effect of the previous call to `await`.
    // `this.regionPicker` is null after `this.currentPage`, and is only populated
    // asynchronously.
    this.regionPicker = this.shadowRoot.querySelector(
      '#regionPicker'
    ) as OutlineRegionPicker;
    this.regionPicker.options = sortOptions(
      filterOptions(zoneOptions).map(option => ({
        markedBestValue: isInFreeTier(option.cloudLocation),
        ...option,
      })),
      this.localize,
      this.language
    );
  }

  private onProjectIdChanged(event: CustomEvent) {
    this.selectedProjectId = event.detail.value;
  }
  private onBillingAccountSelected(event: CustomEvent) {
    this.selectedBillingAccountId = event.detail.value;
  }

  private async onRegionSelected(event: CustomEvent) {
    event.stopPropagation();

    this.regionPicker.isServerBeingCreated = true;
    const zone = event.detail.selectedLocation as Zone;
    const name = this.makeLocalizedServerName(zone);
    const server = await this.account.createServer(
      this.project.id,
      name,
      zone,
      event.detail.metricsEnabled
    );
    const params = {bubbles: true, composed: true, detail: {server}};
    const serverCreatedEvent = new CustomEvent('GcpServerCreated', params);
    this.dispatchEvent(serverCreatedEvent);
  }

  private makeProjectName(): string {
    return `outline-${Math.random().toString(20).substring(3)}`;
  }

  private makeLocalizedServerName(cloudLocation: CloudLocation): string {
    const placeName = getShortName(cloudLocation, this.localize);
    return this.localize('server-name', 'serverLocation', placeName);
  }
}
