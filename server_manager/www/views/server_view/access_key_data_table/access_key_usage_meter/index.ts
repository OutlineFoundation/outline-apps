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

import {formatBinaryBytes, formatBytes} from '../../../../data_formatting';

import '../../icon_tooltip';

@customElement('access-key-usage-meter')
export class AccessKeyUsageMeter extends LitElement {
  @property({type: String}) language: string;
  @property({type: Number}) dataUsageBytes: number;
  @property({type: Number}) dataLimitBytes: number;
  @property({type: Number}) dataLimitWarningThreshold: number = 0.8;
  @property({type: Object}) localize: (messageId: string) => string;

  @property({type: Boolean, reflect: true})
  get dataLimitWarning() {
    return (
      this.dataUsageBytes / this.dataLimitBytes >=
      this.dataLimitWarningThreshold
    );
  }

  static styles = css`
    :host {
      --access-key-usage-meter-font-family: 'Inter', system-ui;
      --access-key-usage-meter-gap: 0.3rem;
      --access-key-usage-meter-size: 0.8rem;

      --access-key-usage-meter-background-color: hsla(0, 0%, 46%, 1);

      --access-key-usage-meter-color: hsla(167, 57%, 61%, 0.88);
      --access-key-usage-meter-text-color: hsl(0, 0%, 79%);

      --access-key-usage-meter-warning-color: hsla(42, 100%, 63%, 1);
      --access-key-usage-meter-warning-text-color: hsla(39, 77%, 53%, 1);

      flex-grow: 1;
    }

    label {
      color: var(--access-key-usage-meter-text-color);
      font-family: var(--access-key-usage-meter-font-family);
    }

    :host([dataLimitWarning]) > label,
    label.data-limit-warning {
      color: var(--access-key-usage-meter-warning-text-color);
    }

    progress {
      display: block;
      appearance: none;
      height: var(--access-key-usage-meter-size);
      margin-bottom: var(--access-key-usage-meter-gap);
      width: 100%;
    }

    progress[value]::-webkit-progress-bar {
      background: var(--access-key-usage-meter-background-color);
    }

    progress[value]::-webkit-progress-value {
      background: var(--access-key-usage-meter-color);
    }

    :host([dataLimitWarning]) > progress[value]::-webkit-progress-value,
    progress.data-limit-warning[value]::-webkit-progress-value {
      background: var(--access-key-usage-meter-warning-color);
    }
  `;

  render() {
    // TODO (#2400): debug why the reflected property doesn't work in electron
    return html`<progress
        class=${classMap({
          'data-limit-warning': this.dataLimitWarning,
        })}
        id="progress"
        max=${this.dataLimitBytes}
        value=${this.dataUsageBytes}
      ></progress>
      <icon-tooltip text="${this.formatDataUsageFractionBinaryTooltip()}">
        <label
          class=${classMap({
            'data-limit-warning': this.dataLimitWarning,
          })}
          for="progress"
        >
          ${formatBytes(this.dataUsageBytes, this.language)} /
          ${formatBytes(this.dataLimitBytes, this.language)}
          ${this.dataLimitWarning
            ? `(${this.localize('server-view-access-keys-usage-limit')})`
            : nothing}
        </label>
      </icon-tooltip>`;
  }

  /**
   * Formats the usage and limit values with binary units for tooltip display.
   *
   * @returns Formatted string showing "usage / limit" in binary units (KiB, MiB, GiB)
   */
  private formatDataUsageFractionBinaryTooltip(): string {
    return `${formatBinaryBytes(this.dataUsageBytes, this.language)} /
      ${formatBinaryBytes(this.dataLimitBytes, this.language)}`;
  }
}
