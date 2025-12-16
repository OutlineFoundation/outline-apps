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

import '@polymer/paper-button/paper-button';
import '@polymer/paper-dialog/paper-dialog';
import './cloud-install-styles';
import {Polymer} from '@polymer/polymer/lib/legacy/polymer-fn';
import {html} from '@polymer/polymer/lib/utils/html-tag';

export interface OutlineMetricsOptionDialog extends Element {
  showMetricsOptInDialog(): void;
}

Polymer({
  _template: html`
    <style include="cloud-install-styles">
      .link {
        text-decoration: underline;
        color: rgba(0, 0, 0, 0.54);
      }
    </style>
    <paper-dialog id="metricsEnabledDialog" modal="">
      <div class="dialogBanner"><img src="images/metrics.png" /></div>
      <h3>[[localize('metrics-title')]]</h3>
      <p
        inner-h-t-m-l="[[localize('metrics-description', 'openLink', '<a class=link href=https://s3.amazonaws.com/outline-vpn/static_downloads/Outline-Data-Collection-Policy.html>', 'closeLink', '</a>')]]"
      ></p>
      <div class="buttons">
        <paper-button dialog-dismiss="" on-tap="disableMetricsRequested"
          >[[localize('metrics-skip')]]</paper-button
        >
        <paper-button
          autofocus=""
          dialog-dismiss=""
          on-tap="enableMetricsRequested"
          >[[localize('metrics-share')]]</paper-button
        >
      </div>
    </paper-dialog>
  `,

  is: 'outline-metrics-option-dialog',

  properties: {
    localize: {
      type: Function,
    },
  },

  showMetricsOptInDialog() {
    this.$.metricsEnabledDialog.open();
  },

  enableMetricsRequested() {
    this.fire('EnableMetricsRequested');
  },

  disableMetricsRequested() {
    this.fire('DisableMetricsRequested');
  },
});
