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

import '@polymer/paper-dialog/paper-dialog';
import './cloud-install-styles';
import {Polymer} from '@polymer/polymer/lib/legacy/polymer-fn';
import {html} from '@polymer/polymer/lib/utils/html-tag';

export interface OutlineAboutDialog extends Element {
  open(): void;
}

Polymer({
  _template: html`
    <style include="cloud-install-styles">
      #dialog {
        width: 80%;
        text-align: center;
      }

      #outlineLogo {
        height: 100px;
        margin-top: 20px;
      }

      #version {
        font-weight: bold;
      }

      p {
        margin: 20px 0 0 0;
        text-align: left;
      }

      #version {
        margin: 0;
        text-align: center;
      }

      a {
        color: #00ac9b;
      }

      #licenses {
        min-width: 90%;
      }

      #licenses code {
        font-size: 0.7em;
      }
    </style>

    <paper-dialog id="dialog" modal="">
      <div>
        <img id="outlineLogo" src="images/manager-about-logo2x.png" />
      </div>
      <p
        id="version"
        inner-h-t-m-l="[[localize('about-version', 'version', outlineVersion)]]"
      ></p>
      <p
        inner-h-t-m-l="[[localize('about-outline', 'shadowsocksUrl', 'https://shadowsocks.org', 'gitHubUrl', 'https://github.com/orgs/OutlineFoundation/repositories?q=outline', 'redditUrl', 'https://www.reddit.com/r/outlinevpn', 'mediumUrl', 'https://medium.com/jigsaw')]]"
      >
        &gt;
      </p>
      <div class="buttons">
        <paper-button dialog-dismiss="" autofocus=""
          >[[localize('close')]]</paper-button
        >
      </div>
    </paper-dialog>
  `,

  is: 'outline-about-dialog',

  properties: {
    localize: Function,
    outlineVersion: String,
  },

  open() {
    this.$.dialog.open();
  },
});
