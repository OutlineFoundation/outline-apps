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

import type {
  MdFilledSelect,
  MdFilledTextField,
  MdRadio,
} from '@material/web/all.js';

import {LitElement, html, css} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import '@material/web/all.js';

interface DnsServerUI {
  url: URL;
  nameMessageId: string;
  descriptionMessageId: string;
}

type DnsConfigurationUI =
  | {
      server: DnsServerUI;
    }
  | {
      custom: URL;
    };

@customElement('dns-config-dialog')
export class DnsConfigDialog extends LitElement {
  @property({type: Boolean}) open: boolean = false;
  @property({type: Object}) localize!: (key: string) => string;

  @property({type: Array}) serverOptions: DnsServerUI[] = [];
  @property({type: Object}) configuration: DnsConfigurationUI;

  @query('#server-selector') private serverSelector: MdFilledSelect;
  @query('#custom-url-input') private customUrlInput: MdFilledTextField;

  @state() private editedConfiguration: DnsConfigurationUI;

  static styles = css`
    header {
      font-size: 1.5rem;
      padding: 1.5rem;
      padding-bottom: var(--outline-mini-gutter);
    }

    article {
      font-weight: 400;
      font-size: 0.875rem;
      line-height: 1.25rem;
      letter-spacing: 0.5px;
      padding: var(--outline-mini-gutter) 1.5rem;
    }

    .description {
      color: var(--md-sys-color-on-surface-variant);
      margin-bottom: var(--outline-large-gutter);
    }

    a {
      color: var(--outline-primary);
      text-decoration: underline;
    }

    .configuration-options {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--outline-large-gutter) var(--outline-gutter);
      margin-bottom: var(--outline-gutter);
    }

    .configuration-option-stack {
      display: flex;
      flex-direction: column;
      gap: var(--outline-mini-gutter);
    }

    md-filled-select {
      --md-filled-select-text-field-container-color: transparent;

      min-width: auto;
    }

    md-filled-select::part(menu) {
      --md-menu-container-color: var(--outline-white);
      --md-menu-item-selected-container-color: var(--outline-primary-light);
    }

    md-filled-select,
    md-filled-text-field {
      --md-filled-field-content-size: 0.875rem;

      --md-filled-field-leading-space: 2px;
      --md-filled-field-top-space: var(--outline-mini-gutter);
      --md-filled-field-bottom-space: var(--outline-mini-gutter);
    }

    .built-in-server-description {
      font-size: 0.875rem;

      margin: 0;
    }

    fieldset {
      border: none;
      text-transform: uppercase;
    }
  `;

  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('open') && this.open) {
      if (this.configuration) {
        return (this.editedConfiguration = {...this.configuration});
      }

      this.editedConfiguration = {server: this.currentlySelectedServer};
    }

    if (changedProperties.has('configuration') && this.configuration) {
      this.editedConfiguration = {...this.configuration};
    }
  }

  get currentlySelectedServer() {
    return (
      this.serverOptions.find(
        server => server.url.toString() === this.serverSelector?.value
      ) ?? this.serverOptions[0]
    );
  }

  render() {
    return html`
      <md-dialog .open=${this.open} @close=${this.close} quick>
        <header slot="headline">${this.localize('dns-select-title')}</header>

        <article slot="content">
          <div class="description">
            ${unsafeHTML(this.localize('dns-select-description'))}
          </div>

          <div class="configuration-options">
            <md-radio
              id="dns-built-in-server-option"
              name="config-type"
              value="server"
              @change=${this.switchConfigurationType}
              ?checked=${'server' in this.editedConfiguration}
            ></md-radio>
            <div class="configuration-option-stack">
              <label for="dns-built-in-server-option"
                >${this.localize('dns-built-in-server')}</label
              >
              <md-filled-select
                id="server-selector"
                .value=${this.currentlySelectedServer?.url.toString()}
                @change=${this.selectServer}
              >
                ${this.serverOptions.map(
                  server => html`
                    <md-select-option .value=${server.url.toString()}>
                      <div slot="headline">
                        ${this.localize(server.nameMessageId)}
                      </div>
                    </md-select-option>
                  `
                )}
              </md-filled-select>
              <p class="built-in-server-description">
                ${unsafeHTML(
                  this.localize(
                    this.currentlySelectedServer?.descriptionMessageId
                  )
                )}
              </p>
            </div>
            <md-radio
              id="dns-custom-server-option"
              name="config-type"
              value="custom"
              @change=${this.switchConfigurationType}
              ?checked=${'custom' in this.editedConfiguration}
            ></md-radio>
            <div class="configuration-option-stack">
              <label for="dns-custom-server-option"
                >${this.localize('dns-custom-server')}</label
              >
              <md-filled-text-field
                id="custom-url-input"
                .value=${'custom' in this.editedConfiguration
                  ? this.editedConfiguration.custom.toString()
                  : ''}
                placeholder=${this.localize('dns-custom-placeholder')}
                @input=${this.inputCustomUrl}
              ></md-filled-text-field>
            </div>
          </div>
        </article>

        <fieldset slot="actions">
          <md-text-button @click=${this.close}>
            ${this.localize('cancel')}
          </md-text-button>
          <md-filled-button @click=${this.confirm}>
            ${this.localize('accept')}
          </md-filled-button>
        </fieldset>
      </md-dialog>
    `;
  }

  private switchConfigurationType(event: Event) {
    const element = event.target as MdRadio;

    switch (element.value) {
      case 'server':
        this.editedConfiguration = {
          server: this.currentlySelectedServer,
        };
        break;
      case 'custom':
        this.editedConfiguration = {
          custom: new URL(this.customUrlInput.value),
        };
        break;
    }
  }

  private selectServer(event: Event) {
    const element = event.target as MdFilledSelect;

    this.editedConfiguration = {
      server: this.serverOptions.find(
        server => server.url.toString() === element.value
      ),
    };
  }

  private inputCustomUrl(event: Event) {
    const element = event.target as MdFilledTextField;

    this.editedConfiguration = {
      custom: new URL(element.value),
    };
  }

  private close() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  private confirm() {
    this.dispatchEvent(
      new CustomEvent('confirm', {detail: this.editedConfiguration})
    );
  }
}
