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
import {classMap} from 'lit/directives/class-map.js';
import {ifDefined} from 'lit/directives/if-defined.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import type {ServerMetricsData} from './index';
import {
  formatBinaryBytes,
  formatBytes,
  getDataFormattingParams,
} from '../../../data_formatting';

import '../icon_tooltip';
import './index';
import '@material/mwc-icon';

export interface ServerMetricsBandwidthLocation {
  bytes: number;
  asn: string;
  asOrg?: string;
  countryFlag: string;
}

@customElement('server-metrics-bandwidth-row')
export class ServerMetricsBandwidthRow extends LitElement {
  @property({type: String}) language: string = 'en';
  @property({type: Object}) localize: (...keys: string[]) => string;
  @property({type: Object}) metrics: ServerMetricsData;
  @property({type: Number}) dataLimitBytes: number = 0;
  @property({type: Number}) dataLimitThreshold: number = 0.8;
  @property({type: Boolean}) hasAccessKeyDataLimits: boolean;
  @property({type: Array})
  locations: Array<ServerMetricsBandwidthLocation>;

  @property({type: Boolean, reflect: true})
  get bandwidthLimitWarning() {
    if (this.dataLimitBytes === 0) {
      return false;
    }

    return this.bandwidthPercentage >= this.dataLimitThreshold;
  }

  get bandwidthPercentage() {
    return this.metrics.dataTransferred.bytes / this.dataLimitBytes;
  }

  static styles = css`
    :host {
      --server-metrics-bandwidth-row-icon-size: 1rem;
      --server-metrics-bandwidth-row-icon-button-size: 1.3rem;

      --server-metrics-bandwidth-row-font-family: 'Inter', system-ui;
      --server-metrics-bandwidth-row-title-color: hsla(0, 0%, 100%, 0.7);
      --server-metrics-bandwidth-row-title-container-gap: 0.25rem;
      --server-metrics-bandwidth-row-title-font-size: 1rem;
      --server-metrics-bandwidth-row-padding: 0.9rem 1.3rem;

      --server-metrics-bandwidth-row-value-container-margin-top: 0.75rem;

      --server-metrics-bandwidth-row-value-font-size: 2.25rem;
      --server-metrics-bandwidth-row-value-font-family: 'Roboto', system-ui;
      --server-metrics-bandwidth-row-value-label-font-size: 0.825rem;
      --server-metrics-bandwidth-row-value-label-margin-left: 0.2rem;

      --server-metrics-bandwidth-row-meter-size: 0.6rem;

      --server-metrics-bandwidth-row-meter-background-color: hsla(
        0,
        0%,
        85%,
        1
      );

      --server-metrics-bandwidth-row-meter-color: hsla(167, 57%, 61%, 0.88);
      --server-metrics-bandwidth-row-meter-text-color: hsl(0, 0%, 79%);

      --server-metrics-bandwidth-row-meter-warning-color: hsla(
        42,
        100%,
        63%,
        1
      );

      --server-metrics-bandwidth-row-bandwidth-progress-container-gap: 0.5rem;
      --server-metrics-bandwidth-row-current-and-peak-border: 1px solid
        hsla(0, 0%, 100%, 0.35);
      --server-metrics-bandwidth-row-current-and-peak-container-gap: 0.9rem;
      --server-metrics-bandwidth-row-current-and-peak-value-font-size: 1.5rem;
      --server-metrics-bandwidth-row-current-and-peak-inner-container-gap: 0.25rem;
      --server-metrics-bandwidth-row-peak-timestamp-text-color: hsla(
        0,
        0%,
        100%,
        0.5
      );
    }

    .main-container {
      display: flex;
      gap: 1rem;
    }

    .title-and-bandwidth-container,
    .current-and-peak-container {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      padding: var(--server-metrics-bandwidth-row-padding);
    }

    .title-container {
      display: flex;
      align-items: center;
      gap: var(--server-metrics-bandwidth-row-title-container-gap);
    }

    .title {
      all: initial;
      display: inline-block;
      font-family: var(--server-metrics-bandwidth-row-font-family);
      font-weight: 400;
      font-size: var(--server-metrics-bandwidth-row-title-font-size);
      color: var(--server-metrics-bandwidth-row-title-color);
    }

    mwc-icon {
      --mdc-icon-size: var(--server-metrics-bandwidth-row-icon-size);
    }

    icon-tooltip {
      --icon-tooltip-icon-size: var(--server-metrics-bandwidth-row-icon-size);
      --icon-tooltip-button-size: var(
        --server-metrics-bandwidth-row-icon-button-size
      );
    }

    .bandwidth-container {
      margin-top: var(
        --server-metrics-bandwidth-row-value-container-margin-top
      );
    }

    .bandwidth-percentage {
      font-family: var(--server-metrics-bandwidth-row-value-font-family);
      font-size: var(--server-metrics-bandwidth-row-value-font-size);
    }

    :host([bandwidthLimitWarning]) .bandwidth-percentage,
    .bandwidth-limit-warning .bandwidth-percentage {
      color: var(--server-metrics-bandwidth-row-meter-warning-color);
    }

    .bandwidth-fraction {
      color: var(--server-metrics-bandwidth-row-title-color);
      font-family: var(--server-metrics-bandwidth-row-font-family);
      font-size: var(--server-metrics-bandwidth-row-value-label-font-size);
      margin-left: var(--server-metrics-bandwidth-row-value-label-margin-left);
    }

    .bandwidth-progress-container {
      display: flex;
      align-items: center;
      gap: var(--server-metrics-bandwidth-row-value-container-margin-top);

      /* TODO: use calc() here. compensates for the height offset when the warning icon is displayed */
      padding: 0.825rem 0;
    }

    progress {
      display: block;
      appearance: none;
      height: var(--server-metrics-bandwidth-row-meter-size);
      margin-bottom: var(--server-metrics-bandwidth-row-meter-gap);
      width: 100%;
    }

    progress[value]::-webkit-progress-bar {
      /* crops the progress value so it doesn't render outside the container's border-radius */
      overflow: hidden;
      background: var(--server-metrics-bandwidth-row-meter-background-color);
      border-radius: var(--server-metrics-bandwidth-row-meter-size);
    }

    progress[value]::-webkit-progress-value {
      background: var(--server-metrics-bandwidth-row-meter-color);
      border-radius: var(--server-metrics-bandwidth-row-meter-size);
    }

    .bandwidth-progress-container icon-tooltip {
      display: none;

      --icon-tooltip-icon-color: var(
        --server-metrics-bandwidth-row-meter-warning-color
      );
    }

    :host([bandwidthLimitWarning]) progress[value]::-webkit-progress-value,
    .bandwidth-limit-warning progress[value]::-webkit-progress-value {
      background: var(--server-metrics-bandwidth-row-meter-warning-color);
    }

    :host([bandwidthLimitWarning]) .bandwidth-progress-container,
    .bandwidth-limit-warning .bandwidth-progress-container {
      padding: 0;
    }

    :host([bandwidthLimitWarning]) .bandwidth-progress-container icon-tooltip,
    .bandwidth-limit-warning .bandwidth-progress-container icon-tooltip {
      display: block;
    }

    .current-and-peak-container {
      gap: var(--server-metrics-bandwidth-row-current-and-peak-container-gap);
      border-left: var(--server-metrics-bandwidth-row-current-and-peak-border);
    }

    .current-and-peak-container[dir='rtl'] {
      border-left: none;
      border-right: var(--server-metrics-bandwidth-row-current-and-peak-border);
    }

    .current-container,
    .peak-container {
      display: flex;
      flex-direction: column;
      gap: var(--server-metrics-bandwidth-row-value-container-margin-top);
    }

    .current-value,
    .peak-value {
      font-family: var(--server-metrics-bandwidth-row-value-font-family);
      font-size: var(
        --server-metrics-bandwidth-row-current-and-peak-value-font-size
      );
    }

    .current-unit,
    .peak-unit {
      color: var(--server-metrics-bandwidth-row-title-color);
      font-family: var(--server-metrics-bandwidth-row-font-family);
      font-size: var(--server-metrics-bandwidth-row-value-label-font-size);
    }

    .current-title,
    .peak-title {
      color: var(--server-metrics-bandwidth-row-title-color);
      font-family: var(--server-metrics-bandwidth-row-font-family);
      font-size: var(--server-metrics-bandwidth-row-value-label-font-size);
    }

    .peak-timestamp {
      color: var(--server-metrics-bandwidth-row-peak-timestamp-text-color);
      font-family: var(--server-metrics-bandwidth-row-font-family);
      font-size: var(--server-metrics-bandwidth-row-value-label-font-size);
      font-style: italic;
    }

    /* TODO: switch to container query once we upgrade Electron */
    @media (max-width: 720px) {
      .main-container {
        flex-direction: column;
        gap: 0;
      }

      .current-and-peak-container,
      .current-and-peak-container[dir='rtl'] {
        padding-top: 0;
        border: none;
      }
    }
  `;

  render() {
    return html`
      <server-metrics-row
        .subcards=${this.locations.map(asn => {
          if (!asn.asOrg) {
            return {
              title: 'Unknown',
              highlight: formatBytes(asn.bytes, this.language),
              highlightTooltip: formatBinaryBytes(asn.bytes, this.language),
            };
          }

          return {
            title: asn.asOrg,
            subtitle: asn.asn,
            highlight: formatBytes(asn.bytes, this.language),
            highlightTooltip: formatBinaryBytes(asn.bytes, this.language),
            icon: asn.countryFlag,
          };
        })}
        .subtitle=${this.localize(
          'server-view-server-metrics-bandwidth-as-breakdown',
          'openItalics',
          '<i>',
          'closeItalics',
          '</i>'
        )}
      >
        <!-- TODO(#2400): debug why the reflected property doesn't work in electron -->
        <div
          class=${classMap({
            'bandwidth-limit-warning': this.bandwidthLimitWarning,
            'main-container': true,
          })}
        >
          <div class="title-and-bandwidth-container">
            <div class="title-container">
              <mwc-icon>data_usage</mwc-icon>
              <h2 class="title">
                ${unsafeHTML(
                  this.localize(
                    'server-view-server-metrics-bandwidth-title',
                    'openItalics',
                    '<i>',
                    'closeItalics',
                    '</i>'
                  )
                )}
              </h2>
              <icon-tooltip
                text="${this.localize(
                  'server-view-server-metrics-bandwidth-tooltip'
                )}"
              ></icon-tooltip>
            </div>
            <div class="bandwidth-container">
              ${this.renderBandwidthPercentage()}
            </div>
          </div>
          <div
            class="current-and-peak-container"
            .dir=${document.documentElement.dir}
          >
            <div class="current-container">
              <span class="current-value-and-unit">
                ${this.metrics.bandwidth
                  ? html`<icon-tooltip
                      text="${this.formatBandwidthBinaryTooltip(
                        this.metrics.bandwidth.current.data.bytes
                      )}"
                      position="right"
                    >
                      <span class="current-value">
                        ${this.formatBandwidthValue(
                          this.metrics.bandwidth.current.data.bytes
                        )}
                      </span>
                      <span class="current-unit">
                        ${this.formatBandwidthUnit(
                          this.metrics.bandwidth.current.data.bytes
                        )}
                      </span>
                    </icon-tooltip>`
                  : html`<span class="current-value">-</span>`}
              </span>
              <span class="current-title"
                >${this.localize(
                  'server-view-server-metrics-bandwidth-usage'
                )}</span
              >
            </div>
            <div class="peak-container">
              <span class="peak-value-and-unit">
                ${this.metrics.bandwidth
                  ? html`<icon-tooltip
                      text="${this.formatBandwidthBinaryTooltip(
                        this.metrics.bandwidth.peak.data.bytes
                      )}"
                    >
                      <span class="peak-value">
                        ${this.formatBandwidthValue(
                          this.metrics.bandwidth.peak.data.bytes
                        )}
                      </span>
                      <span class="peak-unit">
                        ${this.formatBandwidthUnit(
                          this.metrics.bandwidth.peak.data.bytes
                        )}
                      </span>
                    </icon-tooltip>`
                  : html`<span class="peak-value">-</span>`}
                ${this.metrics.bandwidth?.peak.timestamp
                  ? html`<span class="peak-timestamp"
                      >(${this.metrics.bandwidth.peak.timestamp.toLocaleString(
                        this.language
                      )})</span
                    >`
                  : nothing}
              </span>
              <span class="peak-title"
                >${unsafeHTML(
                  this.localize(
                    'server-view-server-metrics-bandwidth-usage-max',
                    'openItalics',
                    '<i>',
                    'closeItalics',
                    '</i>'
                  )
                )}</span
              >
            </div>
          </div>
        </div>
      </server-metrics-row>
    `;
  }

  private renderBandwidthPercentage() {
    if (!this.metrics.dataTransferred) {
      return html`<span class="bandwidth-percentage">-</span>`;
    }

    if (this.dataLimitBytes === 0) {
      return html`<icon-tooltip
        text="${this.formatDataAmountBinaryTooltip(
          this.metrics.dataTransferred.bytes
        )}"
        position="right"
      >
        <span class="bandwidth-percentage">
          ${formatBytes(this.metrics.dataTransferred.bytes, this.language)}
        </span>
      </icon-tooltip>`;
    }

    return html`<span class="bandwidth-percentage">
        ${this.formatPercentage(this.bandwidthPercentage)}
      </span>
      <icon-tooltip
        text="${this.formatDataAmountBinaryTooltip(
          this.metrics.dataTransferred.bytes
        )}
        / ${this.formatDataAmountBinaryTooltip(this.dataLimitBytes)}"
        position="right"
      >
        <span class="bandwidth-fraction">
          ${formatBytes(this.metrics.dataTransferred.bytes, this.language)} /
          ${formatBytes(this.dataLimitBytes, this.language)}
        </span>
      </icon-tooltip>
      <span class="bandwidth-progress-container">
        <progress
          max=${this.dataLimitBytes}
          value=${this.metrics.dataTransferred.bytes}
        ></progress>
        <icon-tooltip
          text=${ifDefined(
            this.hasAccessKeyDataLimits
              ? undefined
              : this.localize(
                  'server-view-server-metrics-bandwidth-limit-tooltip'
                )
          )}
          icon="warning"
        ></icon-tooltip>
      </span>`;
  }

  // TODO: move to formatter library
  private formatPercentage(percentage: number) {
    const formatter = Intl.NumberFormat(this.language, {
      style: 'percent',
      minimumFractionDigits: 0,
    });

    // TODO: properly internationalize the greater than/less than symbols
    if (percentage > 1) {
      return `>${formatter.format(1)}`;
    }

    if (percentage < 0.01) {
      return `<${formatter.format(0.01)}`;
    }

    return formatter.format(percentage);
  }

  private formatBandwidthUnit(bytesPerSecond: number) {
    return (
      this.formatBandwidthParts(bytesPerSecond)
        .find(({type}) => type === 'unit')
        .value // Special case for "byte", since we'd rather be consistent with "KB", etc.  "byte" is
        // presumably used due to the example in the Unicode standard,
        // http://unicode.org/reports/tr35/tr35-general.html#Example_Units
        .replace(/bytes?/, ' B')
    );
  }

  /**
   * Formats bandwidth value with binary units for tooltip display.
   * Converts bytes per second to human-readable binary format (KiB/s, MiB/s, etc.)
   *
   * @param bytesPerSecond The bandwidth in bytes per second
   * @returns Formatted string with binary units
   */
  private formatBandwidthBinaryTooltip(bytesPerSecond: number): string {
    // Format the numeric value with binary units, then append "/s" for rate
    return `${formatBinaryBytes(bytesPerSecond, this.language)}/s`;
  }

  /**
   * Formats a data amount with binary units for tooltip display.
   * Used for total data transferred (not a rate).
   *
   * @param bytes The amount of data in bytes
   * @returns Formatted string with binary units
   */
  private formatDataAmountBinaryTooltip(bytes: number): string {
    return formatBinaryBytes(bytes, this.language);
  }

  private formatBandwidthValue(bytesPerSecond: number) {
    return this.formatBandwidthParts(bytesPerSecond)
      .filter(
        ({type}) =>
          type === 'integer' ||
          type === 'decimal' ||
          type === 'group' ||
          type === 'fraction'
      )
      .reduce((string, {value}) => string + value, '');
  }

  private formatBandwidthParts(bytesPerSecond: number) {
    const {value, unit, decimalPlaces} =
      getDataFormattingParams(bytesPerSecond);

    return new Intl.NumberFormat(this.language, {
      style: 'unit',
      unit: `${unit}-per-second`,
      maximumFractionDigits: decimalPlaces,
    }).formatToParts(value);
  }
}
