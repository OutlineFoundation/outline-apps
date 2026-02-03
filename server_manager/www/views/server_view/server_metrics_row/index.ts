/**
 * Copyright 2025 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {ifDefined} from 'lit/directives/if-defined.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import '../icon_tooltip';
import '@material/mwc-icon';

import './server_metrics_row_subcard';
import type {ServerMetricsRowSubcard} from './server_metrics_row_subcard';

export interface ServerMetricsData {
  dataTransferred: {
    bytes: number;
  };
  tunnelTime?: {
    seconds: number;
  };
  bandwidth?: {
    peak: {
      data: {
        bytes: number;
      };
      timestamp?: Date;
    };
    current: {
      data: {
        bytes: number;
      };
      timestamp?: Date;
    };
  };
}

@customElement('server-metrics-row')
export class ServerMetricsRow extends LitElement {
  @property({type: Array}) subcards?: Array<Partial<ServerMetricsRowSubcard>>;
  @property({type: String}) subtitle?: string;

  static styles = css`
    :host {
      --server-metrics-row-background: hsl(200, 10.7%, 22%);
      --server-metrics-row-font-family: 'Inter', system-ui;
      --server-metrics-row-icon-size: 1.38rem;
      --server-metrics-row-text-color: hsla(0, 0%, 100%, 0.8);
      --server-metrics-row-padding: 0.9rem 1.3rem;

      --server-metrics-row-footer-top-border: 1px solid hsla(0, 0%, 100%, 0.35);

      --server-metrics-row-subtitle-font-size: 0.75rem;
      --server-metrics-row-subtitle-margin-bottom: 0.75rem;

      --server-metrics-row-subcards-gap: 0.56rem;
      --server-metrics-row-subcards-min-width: 180px;
    }

    section {
      background-color: var(--server-metrics-row-background);
      box-sizing: border-box;
      color: var(--server-metrics-row-text-color);
      display: block;
      font-family: 'iRoboto', system-u;
      width: 100%;
    }

    aside {
      border-top: var(--server-metrics-row-footer-top-border);
      padding: var(--server-metrics-row-padding);
    }

    .subtitle {
      all: initial;
      color: var(--server-metrics-row-title-color);
      display: inline-block;
      font-family: var(--server-metrics-row-font-family);
      font-size: var(--server-metrics-row-subtitle-font-size);
      margin-bottom: var(--server-metrics-row-subtitle-margin-bottom);
    }

    .subcards-container {
      display: grid;
      gap: var(--server-metrics-row-subcards-gap);
      grid-template-columns: repeat(
        auto-fit,
        minmax(var(--server-metrics-row-subcards-min-width), 1fr)
      );
    }
  `;

  render() {
    return html`
      <section>
        <slot></slot>

        ${this.subcards && this.subcards.length
          ? html`
              <aside>
                ${this.subtitle
                  ? html`<h3 class="subtitle">${unsafeHTML(this.subtitle)}</h3>`
                  : nothing}

                <div class="subcards-container">
                  ${this.subcards.map(
                    ({
                      highlight,
                      highlightTooltip,
                      title,
                      subtitle,
                      icon,
                    }) => html`
                      <server-metrics-row-subcard
                        highlight=${ifDefined(highlight)}
                        highlightTooltip=${ifDefined(highlightTooltip)}
                        title=${ifDefined(title)}
                        subtitle=${ifDefined(subtitle)}
                        icon=${ifDefined(icon)}
                      ></server-metrics-row-subcard>
                    `
                  )}
                </div>
              </aside>
            `
          : nothing}
      </section>
    `;
  }
}
