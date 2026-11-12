/*
  Copyright 2026 The Outline Authors

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

import '@material/mwc-icon';
import '@material/mwc-icon-button';

export const DONATE_BANNER_DISMISS_EVENT = 'DonateBannerDismissed';

/**
 * A dismissible bar inviting the server administrator to donate.
 *
 * Fires `DonateBannerDismissed` (bubbling, composed) when the administrator
 * closes the bar or follows the donate link.
 */
@customElement('donate-banner')
export class DonateBanner extends LitElement {
  @property({type: Object}) localize: (messageId: string) => string;
  @property({type: String}) link: string;

  // Colors come from the palette shared through cloud-install-styles, which the server view
  // includes, so the banner matches the rest of the Manager.
  static styles = css`
    :host {
      background-color: var(--background-contrast-color);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      box-sizing: border-box;
      color: var(--light-gray);
      display: block;
      font-size: 0.875rem;
      line-height: 1.4;
      padding: 0.75rem 1rem;
      width: 100%;
    }

    aside {
      align-items: center;
      display: flex;
      gap: 1rem;
    }

    .content {
      align-items: center;
      display: flex;
      flex-grow: 1;
      gap: 1rem;
    }

    .content > mwc-icon {
      --mdc-icon-size: 1.5rem;
      color: var(--primary-green);
      flex-shrink: 0;
    }

    a {
      align-items: center;
      color: var(--primary-green);
      display: inline-flex;
      flex-shrink: 0;
      font-weight: bold;
      gap: 0.25rem;
      text-decoration: none;
      white-space: nowrap;
    }

    a > span {
      text-decoration: underline;
    }

    a > mwc-icon {
      --mdc-icon-size: 1rem;
    }

    mwc-icon-button {
      --mdc-icon-button-size: 2rem;
      --mdc-icon-size: 1.25rem;
      flex-shrink: 0;
    }

    /* TODO(#2384): replace with a container query once we upgrade electron */
    @media (max-width: 900px) {
      aside {
        align-items: flex-start;
      }
      .content {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;

  render() {
    return html`
      <aside>
        <div class="content">
          <mwc-icon>favorite</mwc-icon>
          <span class="message">${this.localize('donate-prompt')}</span>
          <a href="${this.link}" @click=${this.dismiss}>
            <span>${this.localize('nav-donate')}</span>
            <mwc-icon>open_in_new</mwc-icon>
          </a>
        </div>
        <mwc-icon-button
          icon="close"
          aria-label="${this.localize('close')}"
          @click=${this.dismiss}
        ></mwc-icon-button>
      </aside>
    `;
  }

  private dismiss() {
    this.dispatchEvent(
      new CustomEvent(DONATE_BANNER_DISMISS_EVENT, {
        bubbles: true,
        composed: true,
      })
    );
  }
}
