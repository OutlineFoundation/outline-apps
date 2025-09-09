/*
  Copyright 2024 The Outline Authors
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

import type {MdFilledTextField} from '@material/web/all.js';

import '@material/mwc-textfield';

import {LitElement, html, css} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import '@material/web/all.js';

@customElement('server-rename-dialog')
export class ServerRenameDialog extends LitElement {
  @property({type: Boolean}) open: boolean = false;
  @property({type: Object}) localize!: (key: string) => string;
  @property({type: String}) serverId!: string;
  @property({type: String}) serverName!: string;

  @state() internalServerName: string | null = null;

  @query('md-filled-text-field') textField: MdFilledTextField;

  static styles = css`
    :host {
      --md-sys-color-primary: var(--outline-primary);
      --md-sys-shape-corner-extra-large: 2px;
      --md-sys-shape-corner-full: 2px;

      --md-dialog-container-color: var(
        --outline-app-dialog-primary-background-color
      );
      --md-filled-text-field-container-color: var(--outline-input-bg);
      --md-filled-text-field-input-text-color: var(--outline-input-text);
    }

    fieldset {
      border: none;
      text-transform: uppercase;
    }

    mwc-textfield {
      --mdc-text-field-fill-color: var(--outline-input-bg);
      --mdc-text-field-ink-color: var(--outline-input-text);
      --mdc-text-field-label-ink-color: var(--outline-label-color);
      --mdc-text-field-outlined-idle-border-color: var(--outline-input-border);
      --mdc-theme-primary: var(--outline-primary);
      color: var(--outline-input-text);
      border-radius: 4px;
      display: block;
      margin: 0 auto;
    }
  `;

  render() {
    if (this.internalServerName === null) {
      this.internalServerName = this.serverName;
    }

    return html`
      <md-dialog .open=${this.open} @close=${this.handleClose} quick>
        <header slot="headline">${this.localize('server-rename')}</header>
        <!-- 
          On older versions of iOS, md-textfield triggers itself indefinitely here,
          so we must use mwc-textfield
        -->
        <mwc-textfield
          slot="content"
          maxLength="100"
          value="${this.internalServerName}"
          @input=${(e: Event) => {
            this.internalServerName = (e.target as HTMLInputElement).value;
          }}
        ></mwc-textfield>
        <fieldset slot="actions">
          <md-text-button @click=${this.handleClose}
            >${this.localize('cancel')}</md-text-button
          >
          <md-filled-button
            @click=${this.handleRename}
            ?disabled=${this.internalServerName === this.serverName}
            >${this.localize('save')}</md-filled-button
          >
        </fieldset>
      </md-dialog>
    `;
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  private handleRename() {
    this.dispatchEvent(
      new CustomEvent('submit', {
        detail: {id: this.serverId, name: this.internalServerName},
      })
    );
  }
}
