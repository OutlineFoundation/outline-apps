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
import '@polymer/paper-dialog/paper-dialog';

import '@polymer/paper-dialog-scrollable/paper-dialog-scrollable';
import {Polymer} from '@polymer/polymer/lib/legacy/polymer-fn';
import {html} from '@polymer/polymer/lib/utils/html-tag';
import * as clipboard from 'clipboard-polyfill';

export interface OutlineShareDialog extends Element {
  open(accessKey: string): void;
}

// TODO(alalama): add a language selector. This should be a separate instance of
// Polymer.AppLocalizeBehavior so the app language is not changed. Consider refactoring l10n into a
// separate Polymer behavior.
Polymer({
  _template: html`
    <style include="cloud-install-styles"></style>
    <style>
      :host {
        margin: 0px;
      }
      a {
        color: #009485;
      }
      #dialog {
        display: flex;
        flex-flow: column nowrap;
        width: 100%;
        padding: 24px;
      }
      #dialog-header {
        text-align: left;
        margin: 0 0 18px 0;
        padding: 0;
      }
      #dialog-header h3 {
        font-size: 18px;
        color: rgba(0, 0, 0, 0.87);
        opacity: 0.87;
        line-height: 24px;
        padding: 0;
      }
      #dialog-header p {
        font-size: 14px;
        color: rgba(0, 0, 0, 0.54);
        line-height: 20px;
        max-width: 85%;
        margin: 0;
      }
      #selectableInviteText {
        height: 144px;
      }
      #selectableInviteText,
      #selectableAccessKey {
        overflow: auto;
        background-color: #eceff1;
        border-radius: 2px;
        margin: 0;
        padding: 18px;
        font-size: 12px;
        line-height: 18px;
      }
      #selectableInviteText p {
        color: black;
        padding: 0;
        margin-top: 0;
        margin-bottom: 14px;
      }
      #selectableInviteText a {
        text-decoration: underline;
        color: #009485;
        font-weight: 500;
        border: none;
      }
      #selectableAccessKey pre {
        white-space: normal;
      }
      #copyInvitationIndicator,
      #copyAccessKeyIndicator {
        text-align: center;
        color: rgba(0, 0, 0, 0.54);
        margin: 0;
      }
      .button-row {
        margin: 24px 0;
        padding: 0;
        letter-spacing: 0.62px;
      }
      #copyButton {
        color: #f1f2f3;
        background-color: #263238;
      }
      #doneButton {
        color: #009485;
        right: 0;
        position: absolute;
      }
    </style>
    <paper-dialog id="dialog" modal="">
      <div id="dialog-header">
        <h3>[[localize('share-title')]]</h3>
        <p
          inner-h-t-m-l="[[localize('share-description', 'openLink', '<a href=https://securityplanner.org/#/all-recommendations>', 'closeLink', '</a>')]]"
        ></p>
      </div>
      <div
        contenteditable=""
        id="selectableInviteText"
        style="-webkit-text-size-adjust: 100%;"
        inner-h-t-m-l="[[localize('share-invite-html')]]"
      ></div>
      <div id="copyInvitationIndicator" hidden="">
        [[localize('share-invite-copied')]]
      </div>
      <div class="button-row">
        <paper-button id="copyButton" on-tap="copyInvite"
          >[[localize('share-invite-copy')]]</paper-button
        >
      </div>

      <div
        contenteditable=""
        id="selectableAccessKey"
        style="-webkit-text-size-adjust: 100%;"
      >
        <pre><a href="[[accessKey]]">[[accessKey]]</a></pre>
      </div>
      <div id="copyAccessKeyIndicator" hidden="">
        [[localize('share-invite-access-key-copied')]]
      </div>
      <div class="button-row">
        <paper-button id="copyButton" on-tap="copyAccessKey"
          >[[localize('share-invite-copy-access-key')]]</paper-button
        >
        <paper-button id="doneButton" dialog-confirm=""
          >[[localize('done')]]</paper-button
        >
      </div>
    </paper-dialog>
  `,

  is: 'outline-share-dialog',

  properties: {
    localize: {type: Function},
  },

  open(accessKey: string) {
    this.accessKey = accessKey;
    this.$.copyInvitationIndicator.setAttribute('hidden', true);
    this.$.copyAccessKeyIndicator.setAttribute('hidden', true);
    this.$.dialog.open();
  },

  copyInvite() {
    const dt = new clipboard.DT();
    dt.setData('text/plain', this.$.selectableInviteText.innerText);
    dt.setData('text/html', this.$.selectableInviteText.innerHTML);
    clipboard.write(dt);
    this.$.copyInvitationIndicator.removeAttribute('hidden');
  },

  copyAccessKey() {
    const dt = new clipboard.DT();
    dt.setData('text/plain', this.$.selectableAccessKey.innerText);
    dt.setData('text/html', this.$.selectableAccessKey.innerHTML);
    clipboard.write(dt);
    this.$.copyAccessKeyIndicator.removeAttribute('hidden');
  },
});
