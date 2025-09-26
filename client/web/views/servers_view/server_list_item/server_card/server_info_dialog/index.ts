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
import {customElement, property} from 'lit/decorators.js';
import '@material/web/all.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import completeProtectionHeaderImage from '../../../../../assets/dialog_headers/complete_protection.svg';
import proxylessHeaderImage from '../../../../../assets/dialog_headers/proxyless.svg';
import splitTunnelingHeaderImage from '../../../../../assets/dialog_headers/split_tunneling.svg';

@customElement('server-info-dialog')
class ServerInfoDialog extends LitElement {
  @property({type: Boolean}) open: boolean = false;
  @property({type: Object}) localize!: (key: string) => string;

  @property({type: String}) headerImage: string;
  @property({type: String}) titleMessageId: string;
  @property({type: String}) contentMessageId: string;

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

    /* Prevent images from being selectable on iOS, which can cause a crash when trying to save them. */
    img {
      pointer-events: none;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }

    header {
      padding: 0;
      padding-bottom: initial;
      flex-direction: column;
    }

    img {
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }

    h1 {
      box-sizing: border-box;
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: 0px;
      line-height: 1.75rem;
      margin-bottom: 0;
      padding: 0 1.5rem;
      text-align: left;
      vertical-align: middle;
      width: 100%;
    }

    article {
      font-weight: 400;
      font-size: 0.875rem;
      line-height: 1.25rem;
      letter-spacing: 0.5px;
      padding: 1.5rem;
    }

    ul {
      margin: 0;
    }

    fieldset {
      border: none;
      text-transform: uppercase;
    }
  `;

  render() {
    return html`
      <md-dialog .open=${this.open} @close=${this.handleClose} quick>
        <header slot="headline">
          <img src="${this.headerImage}" />
          <h1>${this.localize(this.titleMessageId)}</h1>
        </header>
        <article slot="content">
          ${unsafeHTML(this.localize(this.contentMessageId))}
        </article>
        <fieldset slot="actions">
          <md-text-button @click=${this.handleClose}
            >${this.localize('okay')}</md-text-button
          >
        </fieldset>
      </md-dialog>
    `;
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }
}

@customElement('server-proxyless-info-dialog')
export class ServerProxylessInfoDialog extends ServerInfoDialog {
  constructor() {
    super();
    this.headerImage = proxylessHeaderImage;
    this.titleMessageId = 'server-proxyless-info-dialog-title';
    this.contentMessageId = 'server-proxyless-info-dialog-content';
  }
}

@customElement('server-split-tunneling-info-dialog')
export class ServerSplitTunnelingInfoDialog extends ServerInfoDialog {
  constructor() {
    super();
    this.headerImage = splitTunnelingHeaderImage;
    this.titleMessageId = 'server-split-tunneling-info-dialog-title';
    this.contentMessageId = 'server-split-tunneling-info-dialog-content';
  }
}

@customElement('server-complete-protection-info-dialog')
export class ServerCompleteProtectionInfoDialog extends ServerInfoDialog {
  constructor() {
    super();
    this.headerImage = completeProtectionHeaderImage;
    this.titleMessageId = 'server-complete-protection-info-dialog-title';
    this.contentMessageId = 'server-complete-protection-info-dialog-content';
  }
}
