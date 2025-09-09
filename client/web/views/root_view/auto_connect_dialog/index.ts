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

import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('auto-connect-dialog')
export class AutoConnectDialog extends LitElement {
  @property({type: Object}) localize!: (
    key: string,
    ...args: string[]
  ) => string;
  @property({type: Boolean}) open: boolean = false;

  static styles = css`
    :host {
      --md-sys-color-primary: var(--outline-primary);
      --md-sys-shape-corner-extra-large: 2px;
      --md-sys-shape-corner-full: 2px;
    }

    md-dialog {
      --md-dialog-container-color: var(--outline-dark-primary);
      --md-dialog-supporting-text-color: var(--outline-white);

      text-align: center;
    }

    section {
      margin: 8px 0;
    }

    section.tips {
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    fieldset {
      border: none;
      display: flex;
      justify-content: center;
      text-transform: uppercase;
    }
  `;

  render() {
    return html`
      <md-dialog .open=${this.open} @cancel=${this.handleDismissal} quick>
        <article slot="content">
          <section class="tips">
            <md-icon>emoji_objects</md-icon>${this.localize('tips')}
          </section>
          <section>
            <h2>${this.localize('auto-connect-dialog-title')}</h2>
          </section>
          <section>${this.localize('auto-connect-dialog-detail')}</section>
        </article>
        <fieldset slot="actions">
          <md-text-button @click="${this.handleDismissal}"
            >${this.localize('got-it')}</md-text-button
          >
        </fieldset>
      </md-dialog>
    `;
  }

  private handleDismissal() {
    this.dispatchEvent(
      new CustomEvent('AutoConnectDialogDismissed', {
        bubbles: true,
        composed: true,
      })
    );
  }
}
