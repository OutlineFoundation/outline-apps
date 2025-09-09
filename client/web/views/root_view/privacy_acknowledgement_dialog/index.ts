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

import privacyLock from '../../../assets/privacy-lock.png';

@customElement('privacy-acknowledgement-dialog')
export class PrivacyAcknowledgementDialog extends LitElement {
  @property({type: Object}) localize!: (key: string) => string;
  @property({type: String}) privacyPageUrl: string = '';
  @property({type: Boolean}) open: boolean = false;

  static styles = css`
    :host {
      --md-sys-color-primary: var(--outline-primary);
      --md-sys-shape-corner-extra-large: 2px;
      --md-sys-shape-corner-full: 2px;
    }

    md-dialog {
      --md-dialog-container-color: var(
        --outline-comms-dialog-primary-background-color
      );
      --md-dialog-supporting-text-color: var(
        --outline-comms-dialog-primary-text-color
      );

      text-align: center;
      min-width: 100svw;
      min-width: 100vw;
      min-height: 100svh;
      min-height: 100vh;
      margin: 0;
    }

    article {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 250px);
      margin: 24px auto;
      max-width: 600px;
      min-width: 300px;
      padding: 24px 12px;
      width: 70vw;
    }

    article > figure {
      align-items: center;
      justify-content: center;
      display: flex;
      flex-grow: 1;
    }

    img {
      width: 112px;
      height: 158px;
    }

    h2 {
      line-height: 28px;
    }

    p {
      color: var(--outline-comms-dialog-secondary-text-color);
    }

    a {
      text-decoration: none;
      color: var(--outline-primary);
      cursor: pointer;
      text-transform: uppercase;
      font-weight: bold;
    }

    fieldset {
      align-items: center;
      border: none;
      display: flex;
      gap: 16px;
      justify-content: center;
      text-transform: uppercase;
    }
  `;

  render() {
    return html`
      <md-dialog
        .open=${this.open}
        @cancel=${(event: Event) => event.preventDefault()}
        quick
      >
        <article slot="content">
          <figure>
            <img alt="Privacy lock" src="${privacyLock}" />
          </figure>
          <h2>${this.localize('privacy-title')}</h2>
          <p>${this.localize('privacy-text')}</p>
        </article>
        <fieldset slot="actions">
          <a href="${this.privacyPageUrl}">${this.localize('learn-more')}</a>
          <md-filled-button @click="${this.handleAcknowledgement}" autofocus>
            ${this.localize('got-it')}
          </md-filled-button>
        </fieldset>
      </md-dialog>
    `;
  }

  private handleAcknowledgement() {
    this.dispatchEvent(
      new CustomEvent('PrivacyTermsAcked', {bubbles: true, composed: true})
    );
  }
}
