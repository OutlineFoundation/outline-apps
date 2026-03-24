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
import {Polymer} from '@polymer/polymer/lib/legacy/polymer-fn';
import {html} from '@polymer/polymer/lib/utils/html-tag';
Polymer({
  _template: html`
    <style include="cloud-install-styles"></style>
    <style>
      :host {
        background-color: #263238;
        height: 100%;
        width: 100%;
        position: absolute;
        z-index: 1000;
      }
      .container {
        height: 85%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #logo {
        width: 300px;
        height: 300px;
      }
      #tos {
        color: #fff;
        padding: 24px;
        text-align: center;
      }
      a {
        color: var(--primary-green);
      }
      paper-button {
        color: white;
        margin-left: 12px;
      }
    </style>
    <div class="container">
      <img id="logo" src="images/tos-icon.png" />
    </div>
    <div id="tos">
      <span
        inner-h-t-m-l="[[localize('terms-of-service', 'openLink', '<a href=https://getoutline.org/policies/terms-of-service>', 'closeLink', '</a>')]]"
      ></span>
      <paper-button on-tap="acceptTermsOfService"
        >[[localize('okay')]]</paper-button
      >
    </div>
  `,

  is: 'outline-tos-view',

  properties: {
    hasAcceptedTermsOfService: {
      type: Boolean,
      value: false,
      notify: true,
    },
    localize: {
      type: Function,
    },
  },

  acceptTermsOfService() {
    this.hasAcceptedTermsOfService = true;
  },
});
