/*
 * Copyright 2025 The Outline Authors
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

import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';

import {Appearance} from '../../app/settings';

export type AppearanceDefinition = {
  id: Appearance;
  localizeKey: string;
  icon: string;
};

@customElement('appearance-view')
export class AppearanceView extends LitElement {
  @property({type: Array}) appearances: AppearanceDefinition[];
  @property({type: String}) selectedAppearance: Appearance = Appearance.SYSTEM;
  @property({type: Object}) localize: (key: string) => string = msg => msg;

  // Set the appearance names using localization
  connectedCallback() {
    super.connectedCallback();
    // Update appearance names with localized strings
    this.appearances = [
      {
        id: Appearance.SYSTEM,
        localizeKey: 'appearance-system',
        icon: 'brightness_auto',
      },
      {
        id: Appearance.LIGHT,
        localizeKey: 'appearance-light',
        icon: 'light_mode',
      },
      {
        id: Appearance.DARK,
        localizeKey: 'appearance-dark',
        icon: 'dark_mode',
      },
    ];
  }

  static styles = css`
    :host {
      height: 100%;
      width: 100%;
      background-color: var(--outline-background);
      color: var(--outline-text-color);
      display: block;
    }

    md-list {
      background-color: var(--outline-background);
      --md-list-container-color: var(--outline-card-background);
      color: var(--outline-text-color);
      padding: 8px 0;
    }

    md-list-item {
      cursor: pointer;
      position: relative;
      --md-list-item-label-text-color: var(--outline-text-color);
      --md-list-item-headline-color: var(--outline-text-color);
      --md-list-item-supporting-text-color: var(--outline-text-color);
      color: var(--outline-text-color);
      margin: 4px 0;
    }

    /* Direct override for appearance text - needed for dark mode */
    md-list-item span,
    md-list-item div,
    md-list-item::before,
    md-list-item::after {
      color: var(--outline-text-color);
    }

    md-list-item.selected {
      --md-list-item-label-text-color: var(--outline-primary);
      --md-list-item-headline-color: var(--outline-primary);
      background-color: rgba(var(--outline-primary-rgb, 0, 0, 0), 0.1);
    }

    md-list-item.selected md-icon {
      color: var(--outline-primary);
    }

    md-icon {
      color: var(--outline-text-color);
      font-size: 24px;
    }

    /* Text elements in list items */
    .appearance-item-text {
      color: var(--outline-text-color);
    }

    /* Icon colors */
    .appearance-icon {
      color: var(--outline-text-color);
    }

    .appearance-icon-selected {
      color: var(--outline-primary);
    }

    /* Explicitly set text color for list items */
    md-list-item::part(label),
    md-list-item::part(supporting-text),
    md-list-item::part(headline) {
      color: var(--outline-text-color);
    }

    md-list-item.selected::part(label),
    md-list-item.selected::part(supporting-text),
    md-list-item.selected::part(headline) {
      color: var(--outline-primary);
    }

    /* Override Material Web styling to ensure proper text visibility */
    ::slotted(*) {
      color: var(--outline-text-color);
    }
  `;

  render() {
    return html`
      <md-list>
        ${this.appearances.map(
          ({id, localizeKey, icon}) => html`
            <md-list-item
              class=${classMap({selected: this.selectedAppearance === id})}
              data-value="${id}"
              @click=${() => this.handleAppearanceSelection(id)}
            >
              <md-icon
                slot="start"
                class=${this.selectedAppearance === id
                  ? 'appearance-icon-selected'
                  : 'appearance-icon'}
                >${icon}</md-icon
              >
              <md-ripple></md-ripple>
              <span class="appearance-item-text"
                >${this.localize(localizeKey)}</span
              >
              ${this.selectedAppearance === id
                ? html`<md-icon slot="end" class="appearance-icon-selected"
                    >check</md-icon
                  >`
                : nothing}
            </md-list-item>
          `
        )}
      </md-list>
    `;
  }

  private handleAppearanceSelection(appearance: Appearance) {
    this.selectedAppearance = appearance;
    this.dispatchEvent(
      new CustomEvent('SetAppearanceRequested', {
        bubbles: true,
        composed: true,
        detail: {
          appearance,
        },
      })
    );
  }
}
