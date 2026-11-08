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

  static styles = css`
    :host {
      --donate-banner-max-width: 1920px;
      --donate-banner-background: hsla(174, 100%, 34%, 0.12);
      --donate-banner-border-color: hsla(174, 100%, 34%, 0.4);
      --donate-banner-text-color: hsla(0, 0%, 100%, 0.87);
      --donate-banner-accent-color: hsl(174, 100%, 34%);
      --donate-banner-padding: 0.75rem 1rem;
      --donate-banner-gap: 1rem;
      --donate-banner-icon-size: 1.5rem;
      --donate-banner-link-icon-size: 1rem;
      --donate-banner-font-family: 'Roboto', system-ui;

      background-color: var(--donate-banner-background);
      border: 1px solid var(--donate-banner-border-color);
      border-radius: 4px;
      box-sizing: border-box;
      color: var(--donate-banner-text-color);
      display: block;
      font-family: var(--donate-banner-font-family);
      font-size: 0.875rem;
      line-height: 1.4;
      padding: var(--donate-banner-padding);
      width: 100%;
    }

    aside {
      align-items: center;
      display: flex;
      gap: var(--donate-banner-gap);
      margin: 0 auto;
      max-width: var(--donate-banner-max-width);
      width: 100%;
    }

    .content {
      align-items: center;
      display: flex;
      flex-grow: 1;
      gap: var(--donate-banner-gap);
    }

    .content > mwc-icon {
      --mdc-icon-size: var(--donate-banner-icon-size);
      color: var(--donate-banner-accent-color);
      flex-shrink: 0;
    }

    a {
      align-items: center;
      color: var(--donate-banner-accent-color);
      cursor: pointer;
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
      --mdc-icon-size: var(--donate-banner-link-icon-size);
    }

    mwc-icon-button {
      --mdc-icon-button-size: 2rem;
      --mdc-icon-size: 1.25rem;
      color: var(--donate-banner-text-color);
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
