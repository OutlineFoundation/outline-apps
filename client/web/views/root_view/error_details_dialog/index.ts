/*
  Copyright 2025 The Outline Authors
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

import {LitElement, html, css} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

@customElement('error-details-dialog')
export class ErrorDetailsDialog extends LitElement {
  @property({type: String}) errorDetails: string | null = null;
  @property({type: Object}) localize!: (
    key: string,
    ...args: string[]
  ) => string;
  @property({type: Boolean}) open: boolean;

  @state() copied: boolean = false;

  static styles = css`
    :host {
      --md-sys-color-primary: var(--outline-primary);
      --md-sys-shape-corner-extra-large: 2px;
      --md-sys-shape-corner-full: 2px;

      width: 100%;
      height: 100%;
    }

    md-dialog {
      --md-dialog-container-color: var(
        --outline-app-dialog-primary-background-color
      );

      min-width: 300px;
    }

    article {
      padding: 1rem;
      background-color: var(--outline-light-gray);
      overflow-x: scroll;
    }

    pre {
      margin: 0;
      font-size: 1rem;
      color: var(--outline-error);
    }

    fieldset {
      border: none;
      text-transform: uppercase;
    }
  `;

  render() {
    return html`<md-dialog .open="${this.open}" quick @closed="${this.cleanup}">
      <header slot="headline">
        ${this.localize('error-details-dialog-header')}
      </header>
      <article slot="content">
        <pre>${this.errorDetails}</pre>
      </article>
      <fieldset slot="actions">
        <md-text-button
          @click="${() => {
            navigator.clipboard.writeText(this.errorDetails);
            this.copied = true;
          }}"
        >
          ${this.localize(
            this.copied
              ? 'error-details-dialog-copied'
              : 'error-details-dialog-copy'
          )}
        </md-text-button>
        <md-filled-button @click="${this.cleanup}"
          >${this.localize('error-details-dialog-dismiss')}</md-filled-button
        >
      </fieldset>
    </md-dialog>`;
  }

  cleanup() {
    this.open = false;
    this.copied = false;
  }
}
