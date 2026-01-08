/*
  Copyright 2018 The Outline Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/
import '@polymer/polymer/polymer-legacy';
import '@polymer/app-layout/app-drawer/app-drawer';
import '@polymer/app-layout/app-drawer-layout/app-drawer-layout';
import '@polymer/app-layout/app-toolbar/app-toolbar';
import '@polymer/iron-icon/iron-icon';
import '@polymer/iron-icons/iron-icons';
import '@polymer/iron-pages/iron-pages';
import '@polymer/paper-icon-button/paper-icon-button';
import '@polymer/paper-toast/paper-toast';
import '@polymer/paper-dialog/paper-dialog';
import '@polymer/paper-dialog-scrollable/paper-dialog-scrollable';
import '@polymer/paper-listbox/paper-listbox';
import '@polymer/paper-menu-button/paper-menu-button';
import './cloud-install-styles';
import './outline-about-dialog';
import './outline-contact-us-dialog';
import './outline-do-oauth-step';
import './outline-gcp-oauth-step';
import '../outline-gcp-create-server-app';
import './outline-feedback-dialog';
import './outline-survey-dialog';
import './outline-intro-step';
import './outline-per-key-data-limit-dialog';
import './outline-language-picker';
import './outline-manual-server-entry';
import './outline-modal-dialog';
import './outline-region-picker-step';
import './outline-server-list';
import './outline-tos-view';

import './if_messages';

import type {AppDrawerElement} from '@polymer/app-layout/app-drawer/app-drawer';
import type {AppDrawerLayoutElement} from '@polymer/app-layout/app-drawer-layout/app-drawer-layout';
import {AppLocalizeBehavior} from '@polymer/app-localize-behavior/app-localize-behavior';
import type {PaperDialogElement} from '@polymer/paper-dialog/paper-dialog';
import type {PaperToastElement} from '@polymer/paper-toast/paper-toast';
import type {PolymerElementProperties} from '@polymer/polymer/interfaces';
import {mixinBehaviors} from '@polymer/polymer/lib/legacy/class';
import type {LegacyElementMixin} from '@polymer/polymer/lib/legacy/legacy-element-mixin';
import {html} from '@polymer/polymer/lib/utils/html-tag';
import {PolymerElement} from '@polymer/polymer/polymer-element';

import {DisplayCloudId} from './cloud-assets';
import type {OutlineAboutDialog} from './outline-about-dialog';
import type {OutlineDoOauthStep} from './outline-do-oauth-step';
import type {OutlineFeedbackDialog} from './outline-feedback-dialog';
import type {GcpConnectAccountApp} from './outline-gcp-oauth-step';
import type {LanguageDef} from './outline-language-picker';
import type {OutlineManualServerEntry} from './outline-manual-server-entry';
import type {OutlineMetricsOptionDialog} from './outline-metrics-option-dialog';
import type {OutlineModalDialog} from './outline-modal-dialog';
import type {OutlinePerKeyDataLimitDialog} from './outline-per-key-data-limit-dialog';
import type {OutlineRegionPicker} from './outline-region-picker-step';
import type {
  OutlineServerList,
  ServerViewListEntry,
} from './outline-server-list';
import type {ServerView} from './outline-server-view';
import type {OutlineShareDialog} from './outline-share-dialog';
import type {GcpCreateServerApp} from '../outline-gcp-create-server-app';

const TOS_ACK_LOCAL_STORAGE_KEY = 'tos-ack';

/** A cloud account to be displayed */
type AccountListEntry = {
  id: string;
  name: string;
};

/** An access key to be displayed */
export type ServerListEntry = {
  id: string;
  accountId: string;
  name: string;
  isSynced: boolean;
};

// mixinBehaviors() returns `any`, but the documentation indicates that
// this is the actual return type.
const polymerElementWithLocalize = mixinBehaviors(
  AppLocalizeBehavior,
  PolymerElement
) as new () => PolymerElement & LegacyElementMixin & AppLocalizeBehavior;

export class AppRoot extends polymerElementWithLocalize {
  static get template() {
    return html`
    <style include="cloud-install-styles"></style>
    <style>
      :host {
        --side-bar-width: 48px;
      }
      .app-container {
        margin: 0 auto;
      }
      /* Large display desktops */
      @media (min-width: 1281px) {
        .app-container {
          max-width: 1200px;
        }
      }
      #toast {
        align-items: center;
        display: flex;
        justify-content: space-between;
        padding: 24px;
        max-width: 450px;
      }
      #toast paper-icon-button {
        /* prevents the icon from resizing when there is a long message in the toast */
        flex-shrink: 0;
        padding: 0;
        height: 20px;
        width: 20px;
      }
      /* rtl:begin:ignore */
      #appDrawer {
        --app-drawer-content-container: {
          color: var(--medium-gray);
          background-color: var(--background-contrast-color);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: right;
        }
      }
      /* rtl:end:ignore */
      #appDrawer > * {
        width: 100%;
      }
      .servers {
        overflow-y: scroll;
        flex: 1;
      }
      .servers::-webkit-scrollbar {
        /* Do not display the scroll bar in the drawer or side bar. It is not styled on some platforms. */
        display: none;
      }
      .servers-section {
        padding: 12px 0;
        border-bottom: 1px solid var(--border-color);
      }
      .servers-section:last-child {
        border-bottom: none;
      }
      .servers-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-left: 24px;
        line-height: 39px;
      }
      .servers-header > span {
        flex: 1;
      }
      .do-overflow-menu {
        padding: 24px;
        color: var(--dark-gray);
        text-align: left;
        display: flex;
        flex-direction: column;
      }
      .do-overflow-menu h4 {
        margin-top: 0;
        white-space: nowrap;
      }
      .do-overflow-menu .account-info {
        display: flex;
        align-items: center;
        color: var(--faded-gray);
      }
      .do-overflow-menu .account-info img {
        margin-right: 12px;
        width: 24px;
      }
      .do-overflow-menu .sign-out-button {
        margin-top: 24px;
        align-self: flex-end;
        font-weight: bold;
        cursor: pointer;
        text-transform: uppercase;
      }
      .servers-container {
        padding-right: 12px; /* In case the server name is wraps. */
      }
      .server {
        display: flex;
        align-items: center;
        width: 100%; /* For the side bar icons. */
        margin: 18px 0;
        padding: 6px 0;
        cursor: pointer;
      }
      .server.selected {
        color: white;
        border-left: 2px solid var(--primary-green);
      }
      @keyframes rotate {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
      .server.syncing {
        cursor: wait;
      }
      .syncing .server-icon {
        animation: rotate 1.75s ease-out infinite;
        opacity: 0.5;
      }
      .server-icon {
        width: 22px;
        height: 22px;
        /* Prevent the image from shrinking when the server title spans multiple lines */
        min-width: 22px !important;
        margin: 0 24px;
      }
      .selected > .server-icon {
        /* Account for the selected border width to preserve center alignment. */
        margin-left: 22px;
      }
      .add-server-section {
        padding: 24px 0;
        text-transform: uppercase;
        color: var(--primary-green);
        font-size: 12px;
        letter-spacing: 0.6px;
        border-top: 1px solid var(--border-color);
        border-bottom: 1px solid var(--border-color);
        cursor: pointer;
      }
      .add-server-section paper-icon-item {
        margin-left: 24px;
      }
      .add-server-section paper-icon-item iron-icon {
        margin-right: 24px;
      }
      #appDrawer > paper-listbox {
        color: var(--medium-gray);
        background-color: var(--background-contrast-color);
      }
      #appDrawer > paper-listbox > * {
        display: block;
        cursor: pointer;
        padding-left: 24px;
        font-size: 14px;
        line-height: 40px;
        outline: none;
      }
      #appDrawer a {
        color: inherit;
      }
      #appDrawer a:focus {
        outline: none;
      }
      #links-footer {
        margin-top: 36px;
      }
      #appDrawer .manager-resources-link {
        color: var(--primary-green);
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .legal-links {
        margin: 0 -6px;
      }
      .legal-links > * {
        margin: 0 6px;
      }
      #language-row {
        display: flex;
        align-items: center;
      }
      #language-icon {
        padding-top: 10px;
      }
      #open-in-new-icon {
        width: 16px;
        height: 16px;
      }
      #language-dropdown {
        padding-left: 22px;
        --paper-input-container: {
          width: 156px;
        };
      }
      app-toolbar [main-title] img {
        height: 16px;
        margin-top: 8px;
      }
      .side-bar-margin {
        margin-left: var(--side-bar-width);
      }
      /* rtl:begin:ignore */
      #sideBar {
        --app-drawer-width: var(--side-bar-width);
        --app-drawer-content-container: {
          background-color: var(--background-contrast-color);
        }
      }
      /* rtl:end:ignore */
      .side-bar-container {
        height: 100%;
        text-align: center;
        color: var(--light-gray);
        display: flex;
        flex-direction: column;
      }
      .side-bar-container .servers {
        flex: initial; /* Prevent the server list pushing down the add server button. */
      }
      .side-bar-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid var(--border-color);
      }
      .side-bar-section.menu {
        min-height: 32px;
      }
      .side-bar-section.servers-section {
        padding: 24px 0;
      }
      .side-bar-section .server {
        justify-content: center;
        margin: 12px auto;
        padding: 2px 0;
      }
      .side-bar-section .provider-icon {
        margin-bottom: 12px;
        padding: 12px 0;
        opacity: 0.54;
        filter: grayscale(100%);
      }
      .side-bar-section.add-server-section {
        flex: 1 0 24px;
        border-bottom: none;
      }
      .side-bar-section > .server-icon {
        margin: 0;
      }
      @media (max-width: 1280px) {
        .app-container {
          margin-left: 50px;
        }
      }
    </style>

    <outline-tos-view id="tosView" has-accepted-terms-of-service="{{userAcceptedTos}}" hidden\$="{{hasAcceptedTos}}" localize="[[localize]]"></outline-tos-view>

    <div hidden\$="{{!hasAcceptedTos}}">
      <!-- This responsive width sets the minimum layout area to 648px.  -->
      <app-drawer-layout id="drawerLayout" responsive-width="1255px" on-narrow-changed="_computeShouldShowSideBar" class\$="[[sideBarMarginClass]]">
        <app-drawer id="appDrawer" slot="drawer" on-opened-changed="_computeShouldShowSideBar">
          <app-toolbar class="toolbar" hidden\$="[[shouldShowSideBar]]">
            <paper-icon-button icon="menu" on-click="_toggleAppDrawer"></paper-icon-button>
            <div main-title=""><img src="images/outline-manager-logo.svg"></div>
          </app-toolbar>

          <!-- Servers section -->
          <div class="servers">
            ${this.expandedServersTemplate()}
          </div>

          <!-- Add server -->
          <div class="add-server-section" on-tap="showIntro">
            <paper-icon-item>
              <iron-icon icon="add" slot="item-icon"></iron-icon>[[localize('servers-add')]]
            </paper-icon-item>
          </div>

          <!-- Links section -->
          <paper-listbox>
            <if-messages message-ids="manager-resources" localize="[[localize]]">
              <a
                class="manager-resources-link"
                href="https://www.reddit.com/r/outlinevpn/wiki/index/">
                  <span>[[localize('manager-resources')]]</span>
                  <iron-icon id="open-in-new-icon" icon="open-in-new" />
              </a>
            </if-messages>
            <span on-tap="maybeCloseDrawer">
              <a href="https://s3.amazonaws.com/outline-vpn/static_downloads/Outline-Data-Collection-Policy.html">
                <span>[[localize('nav-data-collection')]]</span>
                <iron-icon id="open-in-new-icon" icon="open-in-new" />
              </a>
            </span>
            <template is="dom-if" if="{{featureFlags.contactView}}">
              <span on-tap="submitFeedbackTapped">[[localize('nav-contact-us')]]</span>
            </template>
            <template is="dom-if" if="{{!featureFlags.contactView}}">
              <span on-tap="submitFeedbackTapped">[[localize('nav-feedback')]]</span>
            </template>
            <span on-tap="maybeCloseDrawer">
              <a href="https://support.google.com/outline/">
                <span>[[localize('nav-help')]]</span>
                <iron-icon id="open-in-new-icon" icon="open-in-new" />
              </a>
            </span>
            <span on-tap="aboutTapped">[[localize('nav-about')]]</span>
            <div id="links-footer">
              <paper-icon-item id="language-row">
                <iron-icon id="language-icon" icon="language" slot="item-icon"></iron-icon>
                <outline-language-picker id="language-dropdown" selected-language="{{language}}" languages="{{supportedLanguages}}"></outline-language-picker>
              </paper-icon-item>
              <div class="legal-links" on-tap="maybeCloseDrawer">
                <a href="https://s3.amazonaws.com/outline-vpn/static_downloads/Outline-Privacy-Policy.html">
                  <span>[[localize('nav-privacy')]]</span>
                  <iron-icon id="open-in-new-icon" icon="open-in-new" />
                </a>
                <a href="https://s3.amazonaws.com/outline-vpn/static_downloads/Outline-Terms-of-Service.html">
                  <span>[[localize('nav-terms')]]</span>
                  <iron-icon id="open-in-new-icon" icon="open-in-new" />
                </a>
                <span on-tap="showLicensesTapped">[[localize('nav-licenses')]]</span>
              </div>
            </div>
          </paper-listbox>
        </app-drawer>

        <app-header-layout>
          <div class="app-container">
            <iron-pages attr-for-selected="id" selected="{{ currentPage }}">
              <outline-intro-step id="intro" digital-ocean-account-name="{{digitalOceanAccount.name}}" gcp-account-name="{{gcpAccount.name}}" localize="[[localize]]"></outline-intro-step>
              <outline-do-oauth-step id="digitalOceanOauth" localize="[[localize]]"></outline-do-oauth-step>
              <outline-gcp-oauth-step id="gcpOauth" localize="[[localize]]"></outline-gcp-oauth-step>
              <outline-gcp-create-server-app id="gcpCreateServer" localize="[[localize]]" language="[[language]]"></outline-gcp-create-server-app>
              <outline-manual-server-entry id="manualEntry" localize="[[localize]]"></outline-manual-server-entry>
              <!-- TODO: Move to a new outline-do-oauth-step. -->
              <outline-region-picker-step id="regionPicker" localize="[[localize]]" language="[[language]]"></outline-region-picker-step>
              <outline-server-list id="serverView" server-list="[[_serverViewList(serverList)]]" selected-server-id="[[selectedServerId]]" language="[[language]]" localize="[[localize]]" feature-flags="[[featureFlags]]"></outline-server-list>
              </div>
            </iron-pages>
          </div>
        </app-header-layout>
      </app-drawer-layout>

      <!-- Side bar -->
      <app-drawer id="sideBar" opened\$="[[shouldShowSideBar]]" persistent="">
        <div class="side-bar-container">
          <div class="side-bar-section menu">
            <paper-icon-button icon="menu" on-click="_toggleAppDrawer"></paper-icon-button>
          </div>
          <div class="servers">
            ${this.minimizedServersTemplate()}
          </div>
          <div class="side-bar-section add-server-section" on-tap="showIntro">
            <paper-icon-item>
              <iron-icon icon="add" slot="item-icon"></iron-icon>
            </paper-icon-item>
          </div>
        </div>
      </app-drawer>

      <paper-toast id="toast"><paper-icon-button icon="icons:close" on-tap="closeError"></paper-icon-button></paper-toast>

      <!-- Modal dialogs must be outside the app container; otherwise the backdrop covers them.  -->
      <outline-survey-dialog id="surveyDialog" localize="[[localize]]"></outline-survey-dialog>
      <template is="dom-if" if="{{featureFlags.contactView}}">
        <outline-contact-us-dialog
          id="feedbackDialog"
          localize="[[localize]]"
          on-success="showContactSuccessToast"
          on-error="showContactErrorToast"
        ></outline-contact-us-dialog>
      </template>
      <template is="dom-if" if="{{!featureFlags.contactView}}">
        <outline-feedback-dialog id="feedbackDialog" localize="[[localize]]"></outline-feedback-dialog>
      </template>
      <outline-about-dialog id="aboutDialog" outline-version="[[outlineVersion]]" localize="[[localize]]"></outline-about-dialog>
      <outline-modal-dialog id="modalDialog"></outline-modal-dialog>
      <outline-share-dialog id="shareDialog" localize="[[localize]]"></outline-share-dialog>
      <outline-metrics-option-dialog id="metricsDialog" localize="[[localize]]"></outline-metrics-option-dialog>
      <outline-per-key-data-limit-dialog id="perKeyDataLimitDialog" language="[[language]]" localize="[[localize]]"></outline-per-key-data-limit-dialog>

      <paper-dialog id="licenses" modal="" restorefocusonclose="">
        <paper-dialog-scrollable>
          <code id="licensesText">
            [[localize('error-licenses')]]
          </code>
        </paper-dialog-scrollable>
        <div class="buttons">
          <paper-button dialog-dismiss="" autofocus="">[[localize('close')]]</paper-button>
        </div>
      </paper-dialog>
    </div>
`;
  }

  static expandedServersTemplate() {
    return html`
      <!-- DigitalOcean servers -->
      <div class="servers-section" hidden$="[[!digitalOceanAccount]]">
        <div class="servers-header">
          <span>[[localize('servers-digitalocean')]]</span>
          <paper-menu-button
            horizontal-align="left"
            class=""
            close-on-activate=""
            no-animations=""
            dynamic-align=""
            no-overlap=""
          >
            <paper-icon-button
              icon="more-vert"
              slot="dropdown-trigger"
            ></paper-icon-button>
            <div class="do-overflow-menu" slot="dropdown-content">
              <h4>[[localize('digitalocean-disconnect-account')]]</h4>
              <div class="account-info">
                <img
                  src="images/digital_ocean_logo.svg"
                />[[digitalOceanAccount.name]]
              </div>
              <div class="sign-out-button" on-tap="_digitalOceanSignOutTapped">
                [[localize('disconnect')]]
              </div>
            </div>
          </paper-menu-button>
        </div>
        <div class="servers-container">
          <template
            is="dom-repeat"
            items="[[serverList]]"
            as="server"
            filter="[[_accountServerFilter(digitalOceanAccount)]]"
            sort="_sortServersByName"
          >
            <div
              class$="server [[_computeServerClasses(selectedServerId, server)]]"
              data-server$="[[server]]"
              on-tap="_showServer"
            >
              <img
                class="server-icon"
                src$="images/[[_computeServerImage(selectedServerId, server)]]"
              />
              <span>[[server.name]]</span>
            </div>
          </template>
        </div>
      </div>
      <!-- GCP servers -->
      <div class="servers-section" hidden$="[[!gcpAccount]]">
        <div class="servers-header">
          <span>[[localize('servers-gcp')]]</span>
          <paper-menu-button
            horizontal-align="left"
            class=""
            close-on-activate=""
            no-animations=""
            dynamic-align=""
            no-overlap=""
          >
            <paper-icon-button
              icon="more-vert"
              slot="dropdown-trigger"
            ></paper-icon-button>
            <div class="do-overflow-menu" slot="dropdown-content">
              <h4>[[localize('gcp-disconnect-account')]]</h4>
              <div class="account-info">
                <img src="images/gcp-logo.svg" />[[gcpAccount.name]]
              </div>
              <div class="sign-out-button" on-tap="_gcpSignOutTapped">
                [[localize('disconnect')]]
              </div>
            </div>
          </paper-menu-button>
        </div>
        <div class="servers-container">
          <template
            is="dom-repeat"
            items="[[serverList]]"
            as="server"
            filter="[[_accountServerFilter(gcpAccount)]]"
            sort="_sortServersByName"
          >
            <div
              class$="server [[_computeServerClasses(selectedServerId, server)]]"
              data-server$="[[server]]"
              on-tap="_showServer"
            >
              <img
                class="server-icon"
                src$="images/[[_computeServerImage(selectedServerId, server)]]"
              />
              <span>[[server.name]]</span>
            </div>
          </template>
        </div>
      </div>
      <!-- Manual servers -->
      <div class="servers-section" hidden$="[[!_hasManualServers(serverList)]]">
        <div class="servers-header">
          <span>[[localize('servers-manual')]]</span>
        </div>
        <div class="servers-container">
          <template
            is="dom-repeat"
            items="[[serverList]]"
            as="server"
            filter="_isServerManual"
            sort="_sortServersByName"
          >
            <div
              class$="server [[_computeServerClasses(selectedServerId, server)]]"
              data-server$="[[server]]"
              on-tap="_showServer"
            >
              <img
                class="server-icon"
                src$="images/[[_computeServerImage(selectedServerId, server)]]"
              />
              <span>[[server.name]]</span>
            </div>
          </template>
        </div>
      </div>
    `;
  }

  static minimizedServersTemplate() {
    return html`
      <!-- DigitalOcean servers -->
      <div
        class="side-bar-section servers-section"
        hidden$="[[!digitalOceanAccount]]"
      >
        <img class="provider-icon" src="images/do_white_logo.svg" />
        <template
          is="dom-repeat"
          items="[[serverList]]"
          as="server"
          filter="[[_accountServerFilter(digitalOceanAccount)]]"
          sort="_sortServersByName"
        >
          <div
            class$="server [[_computeServerClasses(selectedServerId, server)]]"
            data-server$="[[server]]"
            on-tap="_showServer"
          >
            <img
              class="server-icon"
              src$="images/[[_computeServerImage(selectedServerId, server)]]"
            />
          </div>
        </template>
      </div>
      <!-- GCP servers -->
      <div class="side-bar-section servers-section" hidden$="[[!gcpAccount]]">
        <img class="provider-icon" src="images/gcp-logo.svg" />
        <template
          is="dom-repeat"
          items="[[serverList]]"
          as="server"
          filter="[[_accountServerFilter(gcpAccount)]]"
          sort="_sortServersByName"
        >
          <div
            class$="server [[_computeServerClasses(selectedServerId, server)]]"
            data-server$="[[server]]"
            on-tap="_showServer"
          >
            <img
              class="server-icon"
              src$="images/[[_computeServerImage(selectedServerId, server)]]"
            />
          </div>
        </template>
      </div>
      <!-- Manual servers -->
      <div
        class="side-bar-section servers-section"
        hidden$="[[!_hasManualServers(serverList)]]"
      >
        <img class="provider-icon" src="images/cloud.svg" />
        <template
          is="dom-repeat"
          items="[[serverList]]"
          as="server"
          filter="_isServerManual"
          sort="_sortServersByName"
        >
          <div
            class$="server [[_computeServerClasses(selectedServerId, server)]]"
            data-server$="[[server]]"
            on-tap="_showServer"
          >
            <img
              class="server-icon"
              src$="images/[[_computeServerImage(selectedServerId, server)]]"
            />
          </div>
        </template>
      </div>
    `;
  }

  static get is() {
    return 'app-root';
  }

  static get properties(): PolymerElementProperties {
    return {
      // Properties language and useKeyIfMissing are used by Polymer.AppLocalizeBehavior.
      language: {type: String, value: 'en'},
      supportedLanguages: {type: Array},
      useKeyIfMissing: {type: Boolean},
      serverList: {type: Array},
      selectedServerId: {type: String},
      digitalOceanAccount: Object,
      gcpAccount: Object,
      outlineVersion: String,
      userAcceptedTos: {
        type: Boolean,
        // Get notified when the user clicks the OK button in the ToS view
        observer: '_userAcceptedTosChanged',
      },
      hasAcceptedTos: {
        type: Boolean,
        computed: '_computeHasAcceptedTermsOfService(userAcceptedTos)',
      },
      currentPage: {
        type: String,
        observer: '_currentPageChanged',
      },
      shouldShowSideBar: {type: Boolean},
      showManagerResourcesLink: {type: Boolean},
      featureFlags: {
        type: Object,
        value: {
          contactView: true,
          serverMetricsTab: false,
        },
      },
    };
  }

  selectedServerId = '';
  language = 'en';
  supportedLanguages: LanguageDef[] = [];
  useKeyIfMissing = true;
  serverList: ServerListEntry[] = [];
  digitalOceanAccount: AccountListEntry = null;
  gcpAccount: AccountListEntry = null;
  outlineVersion = '';
  currentPage = 'intro';
  shouldShowSideBar = false;
  showManagerResourcesLink = false;

  constructor() {
    super();

    this.addEventListener('RegionSelected', this.handleRegionSelected);
    this.addEventListener(
      'SetUpGenericCloudProviderRequested',
      this.handleSetUpGenericCloudProviderRequested
    );
    this.addEventListener('SetUpAwsRequested', this.handleSetUpAwsRequested);
    this.addEventListener('SetUpGcpRequested', this.handleSetUpGcpRequested);
    this.addEventListener(
      'ManualServerEntryCancelled',
      this.handleManualCancelled
    );
  }

  /**
   * Loads a new translation file and returns a Promise which resolves when the file is loaded or
   *  rejects when there was an error loading translations.
   *
   *  @param language The language code to load translations for, eg 'en'
   */
  loadLanguageResources(language: string) {
    const localizeResourcesResponder = new Promise<void>((resolve, reject) => {
      // loadResources uses events and continuation instead of Promises.  In order to make this
      // function easier to use, we wrap the language-changing logic in event handlers which
      // resolve or reject the Promise.  Note that they need to clean up whichever event handler
      // didn't fire so we don't leak it, which could cause future language changes to not work
      // properly by triggering old event listeners.
      const successHandler = () => {
        this.removeEventListener(
          'app-localize-resources-error',
          failureHandler
        );
        resolve();
      };
      const failureHandler = () => {
        this.removeEventListener(
          'app-localize-resources-loaded',
          successHandler
        );
        reject(new Error(`Failed to load resources for language ${language}`));
      };
      this.addEventListener('app-localize-resources-loaded', successHandler, {
        once: true,
      });
      this.addEventListener('app-localize-resources-error', failureHandler, {
        once: true,
      });
    });

    const messagesUrl = `./messages/${language}.json`;
    this.loadResources(messagesUrl, language, /* merge= */ false);
    return localizeResourcesResponder;
  }

  /**
   * Sets the language and direction for the application
   * @param language The ISO language code for the new language, e.g. 'en'.
   */
  async setLanguage(language: string, direction: 'rtl' | 'ltr') {
    await this.loadLanguageResources(language);

    const alignDir = direction === 'ltr' ? 'left' : 'right';
    (this.$.appDrawer as AppDrawerElement).align = alignDir;
    (this.$.sideBar as AppDrawerElement).align = alignDir;
    this.language = language;

    this.showManagerResourcesLink = this.hasTranslation('manager-resources');
  }

  hasTranslation(key: string) {
    let message;

    try {
      message = this.localize(key);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // failed to find translation
      message = '';
    }

    return message !== key && message !== '';
  }

  showIntro() {
    this.maybeCloseDrawer();
    this.selectedServerId = '';
    this.currentPage = 'intro';
  }

  getDigitalOceanOauthFlow(onCancel: () => void): OutlineDoOauthStep {
    const oauthFlow = this.$.digitalOceanOauth as OutlineDoOauthStep;
    oauthFlow.onCancel = onCancel;
    return oauthFlow;
  }

  showDigitalOceanOauthFlow() {
    this.currentPage = 'digitalOceanOauth';
  }

  getAndShowDigitalOceanOauthFlow(onCancel: () => void) {
    this.currentPage = 'digitalOceanOauth';
    const oauthFlow = this.getDigitalOceanOauthFlow(onCancel);
    oauthFlow.showConnectAccount();
    return oauthFlow;
  }

  getAndShowGcpOauthFlow(onCancel: () => void) {
    this.currentPage = 'gcpOauth';
    const oauthFlow = this.$.gcpOauth as GcpConnectAccountApp;
    oauthFlow.onCancel = onCancel;
    return oauthFlow;
  }

  getAndShowGcpCreateServerApp(): GcpCreateServerApp {
    this.currentPage = 'gcpCreateServer';
    return this.$.gcpCreateServer as GcpCreateServerApp;
  }

  getAndShowRegionPicker(): OutlineRegionPicker {
    this.currentPage = 'regionPicker';
    const regionPicker = this.$.regionPicker as OutlineRegionPicker;
    regionPicker.reset();
    return regionPicker;
  }

  getManualServerEntry() {
    return this.$.manualEntry as OutlineManualServerEntry;
  }

  showServerView() {
    this.currentPage = 'serverView';
  }

  _currentPageChanged() {
    if (this.currentPage !== 'gcpCreateServer') {
      // The refresh loop will be restarted by App, which calls
      // GcpCreateServerApp.start() whenever it switches back to this page.
      (
        this.$.gcpCreateServer as GcpCreateServerApp
      ).stopRefreshingBillingAccounts();
    }
  }

  /** Gets the ServerView for the server given by its id */
  getServerView(displayServerId: string): Promise<ServerView> {
    const serverList =
      this.shadowRoot.querySelector<OutlineServerList>('#serverView');
    return serverList.getServerView(displayServerId);
  }

  handleRegionSelected(e: CustomEvent) {
    this.fire('SetUpDigitalOceanServerRequested', {
      region: e.detail.selectedLocation,
      metricsEnabled: e.detail.metricsEnabled,
    });
  }

  handleSetUpGenericCloudProviderRequested() {
    this.handleManualServerSelected('generic');
  }

  handleSetUpAwsRequested() {
    this.handleManualServerSelected('aws');
  }

  handleSetUpGcpRequested() {
    this.handleManualServerSelected('gcp');
  }

  handleManualServerSelected(cloudProvider: 'generic' | 'aws' | 'gcp') {
    const manualEntry = this.$.manualEntry as OutlineManualServerEntry;
    manualEntry.clear();
    manualEntry.cloudProvider = cloudProvider;
    this.currentPage = 'manualEntry';
  }

  handleManualCancelled() {
    this.currentPage = 'intro';
  }

  showError(errorMsg: string) {
    this.showToast(errorMsg, Infinity);
  }

  showNotification(message: string, durationMs = 3000) {
    this.showToast(message, durationMs);
  }

  /**
   * Show a toast with a message
   * @param duration in seconds
   */
  showToast(message: string, duration: number) {
    const toast = this.$.toast as PaperToastElement;
    toast.close();
    // Defer in order to trigger the toast animation, otherwise the
    // update happens in place.
    setTimeout(() => {
      toast.show({
        text: message,
        duration,
        noOverlap: true,
      });
    }, 0);
  }

  closeError() {
    (this.$.toast as PaperToastElement).close();
  }

  /**
   * @param cb a function which accepts a single boolean which is true
   *     iff
   *      the user chose to retry the failing operation.
   */
  showConnectivityDialog(cb: (retry: boolean) => void) {
    const dialogTitle = this.localize('error-connectivity-title');
    const dialogText = this.localize('error-connectivity');
    void this.showModalDialog(dialogTitle, dialogText, [
      this.localize('digitalocean-disconnect'),
      this.localize('retry'),
    ]).then(clickedButtonIndex => {
      cb(clickedButtonIndex === 1); // pass true if user clicked retry
    });
  }

  getConfirmation(
    title: string,
    text: string,
    confirmButtonText: string,
    continueFunc: () => void
  ) {
    void this.showModalDialog(title, text, [
      this.localize('cancel'),
      confirmButtonText,
    ]).then(clickedButtonIndex => {
      if (clickedButtonIndex === 1) {
        // user clicked to confirm.
        continueFunc();
      }
    });
  }

  showManualServerError(errorTitle: string, errorText: string) {
    void this.showModalDialog(errorTitle, errorText, [
      this.localize('cancel'),
      this.localize('retry'),
    ]).then(clickedButtonIndex => {
      const manualEntry = this.$.manualEntry as OutlineManualServerEntry;
      if (clickedButtonIndex === 1) {
        manualEntry.retryTapped();
      }
    });
  }

  _hasManualServers(serverList: ServerListEntry[]) {
    return serverList.filter(server => !server.accountId).length > 0;
  }

  _userAcceptedTosChanged(userAcceptedTos: boolean) {
    if (userAcceptedTos) {
      window.localStorage[TOS_ACK_LOCAL_STORAGE_KEY] = Date.now();
    }
  }

  _computeHasAcceptedTermsOfService(userAcceptedTos: boolean) {
    return userAcceptedTos || !!window.localStorage[TOS_ACK_LOCAL_STORAGE_KEY];
  }

  _toggleAppDrawer() {
    const drawerLayout = this.$.drawerLayout as AppDrawerLayoutElement;
    const drawerNarrow = drawerLayout.narrow;
    const forceNarrow = drawerLayout.forceNarrow;
    if (drawerNarrow) {
      if (forceNarrow) {
        // The window width is below the responsive threshold. Do not force narrow mode.
        drawerLayout.forceNarrow = false;
      }
      (this.$.appDrawer as AppDrawerElement).toggle();
    } else {
      // Forcing narrow mode when the window width is above the responsive threshold effectively
      // collapses the drawer. Conversely, reverting force narrow expands the drawer.
      drawerLayout.forceNarrow = !forceNarrow;
    }
  }

  maybeCloseDrawer() {
    const drawerLayout = this.$.drawerLayout as AppDrawerLayoutElement;
    if (drawerLayout.narrow || drawerLayout.forceNarrow) {
      (this.$.appDrawer as AppDrawerElement).close();
    }
  }

  submitFeedbackTapped() {
    (
      this.shadowRoot.querySelector('#feedbackDialog') as OutlineFeedbackDialog
    ).open();
    this.maybeCloseDrawer();
  }

  aboutTapped() {
    (this.$.aboutDialog as OutlineAboutDialog).open();
    this.maybeCloseDrawer();
  }

  _digitalOceanSignOutTapped() {
    this.fire('DigitalOceanSignOutRequested');
  }

  _gcpSignOutTapped() {
    this.fire('GcpSignOutRequested');
  }

  openManualInstallFeedback(prepopulatedMessage: string) {
    (
      this.shadowRoot.querySelector('#feedbackDialog') as OutlineFeedbackDialog
    ).open(prepopulatedMessage, true);
  }

  openShareDialog(accessKey: string) {
    (this.$.shareDialog as OutlineShareDialog).open(accessKey);
  }

  openPerKeyDataLimitDialog(
    keyName: string,
    activeDataLimitBytes: number,
    onDataLimitSet: (dataLimitBytes: number) => Promise<boolean>,
    onDataLimitRemoved: () => Promise<boolean>
  ) {
    // attach listeners here
    (this.$.perKeyDataLimitDialog as OutlinePerKeyDataLimitDialog).open(
      keyName,
      activeDataLimitBytes,
      onDataLimitSet,
      onDataLimitRemoved
    );
  }

  showMetricsDialogForNewServer() {
    (
      this.$.metricsDialog as OutlineMetricsOptionDialog
    ).showMetricsOptInDialog();
  }

  /** @return A Promise which fulfills with the index of the button clicked. */
  showModalDialog(
    title: string,
    text: string,
    buttons: string[]
  ): Promise<number> {
    return (this.$.modalDialog as OutlineModalDialog).open(
      title,
      text,
      buttons
    );
  }

  closeModalDialog() {
    return (this.$.modalDialog as OutlineModalDialog).close();
  }

  showLicensesTapped() {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      (this.$.licensesText as HTMLElement).innerText = xhr.responseText;
      (this.$.licenses as PaperDialogElement).open();
    };
    xhr.onerror = () => {
      console.error('could not load license.txt');
    };
    xhr.open('GET', '/ui_components/licenses/licenses.txt', true);
    xhr.send();
  }

  showContactSuccessToast() {
    this.showNotification(this.localize('notification-feedback-thanks'));
  }

  showContactErrorToast() {
    this.showError(this.localize('error-feedback'));
  }

  _computeShouldShowSideBar() {
    const drawerNarrow = (this.$.drawerLayout as AppDrawerLayoutElement).narrow;
    const drawerOpened = (this.$.appDrawer as AppDrawerElement).opened;
    if (drawerOpened && drawerNarrow) {
      this.shouldShowSideBar = false;
    } else {
      this.shouldShowSideBar = drawerNarrow;
    }
  }

  _accountServerFilter(account: AccountListEntry) {
    return (server: ServerListEntry) =>
      account && server.accountId === account.id;
  }

  _isServerManual(server: ServerListEntry) {
    return !server.accountId;
  }

  _sortServersByName(a: ServerListEntry, b: ServerListEntry) {
    const aName = a.name.toUpperCase();
    const bName = b.name.toUpperCase();
    if (aName < bName) {
      return -1;
    } else if (aName > bName) {
      return 1;
    }
    return 0;
  }

  _computeServerClasses(selectedServerId: string, server: ServerListEntry) {
    const serverClasses = [];
    if (this._isServerSelected(selectedServerId, server)) {
      serverClasses.push('selected');
    }
    if (!server.isSynced) {
      serverClasses.push('syncing');
    }
    return serverClasses.join(' ');
  }

  _computeServerImage(selectedServerId: string, server: ServerListEntry) {
    if (this._isServerSelected(selectedServerId, server)) {
      return 'server-icon-selected.png';
    }
    return 'server-icon.png';
  }

  _getCloudId(accountId: string): DisplayCloudId {
    // TODO: Replace separate account fields with a map.
    if (this.gcpAccount && accountId === this.gcpAccount.id) {
      return DisplayCloudId.GCP;
    } else if (
      this.digitalOceanAccount &&
      accountId === this.digitalOceanAccount.id
    ) {
      return DisplayCloudId.DO;
    }
    return null;
  }

  _serverViewList(serverList: ServerListEntry[]): ServerViewListEntry[] {
    return serverList.map(entry => ({
      id: entry.id,
      name: entry.name,
      cloudId: this._getCloudId(entry.accountId),
    }));
  }

  _isServerSelected(selectedServerId: string, server: ServerListEntry) {
    return !!selectedServerId && selectedServerId === server.id;
  }

  _showServer(event: Event & {model: {server: ServerListEntry}}) {
    const server = event.model.server;
    this.fire('ShowServerRequested', {displayServerId: server.id});
    this.maybeCloseDrawer();
  }
}
customElements.define(AppRoot.is, AppRoot);
