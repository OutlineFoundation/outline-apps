/*
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('settings-view')
export class SettingsView extends LitElement {
  @property({type: Boolean}) autoStartOnLoginEnabled = true;
  @property({type: Object}) localize: (key: string) => string = msg => msg;

  static styles = css`
    :host {
      background-color: var(--outline-background);
      color: var(--outline-text-color);
      display: block;
      height: 100%;
      width: 100%;
    }

    md-list {
      --md-list-container-color: var(--outline-card-background);
      background-color: var(--outline-background);
      color: var(--outline-text-color);
      padding: 8px 0;
    }

    md-list-item {
      --md-list-item-headline-color: var(--outline-text-color);
      --md-list-item-label-text-color: var(--outline-text-color);
      --md-list-item-supporting-text-color: var(--outline-text-color);
      color: var(--outline-text-color);
    }

    md-icon {
      color: var(--outline-icon-color);
      font-size: 24px;
    }
  `;

  render() {
    return html`
      <md-list>
        <md-list-item>
          <md-icon slot="start">power_settings_new</md-icon>
          <span>${this.localize('settings-auto-start-on-login')}</span>
          <md-switch
            slot="end"
            ?selected=${this.autoStartOnLoginEnabled}
            @change=${this.handleAutoStartChange}
          ></md-switch>
        </md-list-item>
      </md-list>
    `;
  }

  private handleAutoStartChange(event: Event) {
    const enabled = (event.target as HTMLInputElement & {selected: boolean})
      .selected;
    this.autoStartOnLoginEnabled = enabled;
    this.dispatchEvent(
      new CustomEvent('SetAutoStartOnLoginRequested', {
        bubbles: true,
        composed: true,
        detail: {enabled},
      })
    );
  }
}
