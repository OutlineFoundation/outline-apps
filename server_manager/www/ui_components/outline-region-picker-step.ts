/*
  Copyright 2018 The Outline Authors

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
import '@polymer/paper-button/paper-button';
import '@polymer/paper-progress/paper-progress';
import '@material/mwc-checkbox';
import './outline-step-view';
import './if_messages';

import {css, html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import {COMMON_STYLES} from './cloud-install-styles';
import {CloudLocationOption} from '../../model/location';
import {getShortName, localizeCountry} from '../location_formatting';

const FLAG_IMAGE_DIR = 'images/flags';

// TODO: Reorganize type definitions to improve separation between
// model and view.
export interface RegionPickerOption extends CloudLocationOption {
  markedBestValue?: boolean;
}

@customElement('outline-region-picker-step')
export class OutlineRegionPicker extends LitElement {
  @property({type: Array}) options: RegionPickerOption[] = [];
  @property({type: Number}) selectedIndex = -1;
  @property({type: Boolean}) metricsEnabled = false;
  @property({type: Boolean}) isServerBeingCreated = false;
  @property({type: Function}) localize: (
    msgId: string,
    ...params: string[]
  ) => string;
  @property({type: String}) language: string;

  static get styles() {
    return [
      COMMON_STYLES,
      css`
        input[type='radio'] {
          display: none;
        }
        input[type='radio']:checked + label.city-button {
          background-color: rgba(255, 255, 255, 0.08);
          box-shadow:
            0 0 2px 0 rgba(0, 0, 0, 0.14),
            0 2px 2px 0 rgba(0, 0, 0, 0.12),
            0 1px 3px 0 rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          border: 2px solid var(--primary-green);
        }
        input[type='radio'] + label.city-button:hover {
          border: 2px solid var(--primary-green);
        }
        input[type='radio'] + label.city-button {
          display: inline-block;
          flex: 1;
          /* Distribute space evenly, accounting for margins, so there are always 4 cards per row. */
          min-width: calc(25% - 24px);
          position: relative;
          margin: 4px;
          text-align: center;
          border: 2px solid rgba(0, 0, 0, 0);
          cursor: pointer;
          transition: 0.5s;
          background: var(--background-contrast-color);
          box-shadow:
            0 0 2px 0 rgba(0, 0, 0, 0.14),
            0 2px 2px 0 rgba(0, 0, 0, 0.12),
            0 1px 3px 0 rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }
        input[type='radio']:disabled + label.city-button {
          /* TODO(alalama): make it look good and indicate disabled */
          filter: blur(2px);
        }
        .geo-name {
          color: var(--light-gray);
          font-size: 16px;
          line-height: 19px;
        }
        .country-name {
          color: var(--medium-gray);
          font-size: 12px;
          line-height: 19px;
          text-transform: uppercase;
        }
        paper-button {
          background: var(--primary-green);
          color: #fff;
          text-align: center;
          font-size: 14px;
        }
        .flag {
          width: 100%;
          height: 100%;
        }
        .flag-overlay {
          display: inline-block;
          width: 100px;
          height: 100px;
          border: 4px solid rgba(255, 255, 255, 0.1);
          border-radius: 50%; /* Make a circle */
          position: relative; /* Ensure the gradient uses the correct origin point. */
          margin-bottom: 12px;
        }
        .flag-overlay::after {
          content: '';
          position: absolute;
          top: 0px;
          left: 0px;
          width: 100%;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(
            to right,
            rgba(20, 20, 20, 0.2) 0%,
            rgba(0, 0, 0, 0) 100%
          );
        }
        .best-value-label {
          background-color: var(--primary-green);
          color: #374248;
          position: absolute;
          top: 117px;
          left: 50%;
          transform: translate(-50%, 0);
          display: flex;
          align-items: center;
          min-height: 20px;
          border-radius: 10px;
          padding: 0px 10px 0px 10px;
          font-size: 12px;
          line-height: 14px;
        }
        .card-content {
          display: flex;
          flex-flow: wrap;
        }
        .card-content-row {
          display: flex;
          flex-flow: row wrap;
          justify-content: space-between;
          padding: 12px 0;
          width: 100%;
        }
        .callout {
          background: var(--background-contrast-color);
          border-radius: 4px;
          box-sizing: border-box;
          display: flex;
          gap: 24px;
          padding: 24px;
          padding-top: 12px;
          width: 100%;
        }
        .callout iron-icon {
          --iron-icon-fill-color: white;
          margin-top: 12px;
          width: 48px;
        }
        .callout-content {
          display: flex;
          flex-flow: column wrap;
          gap: 12px;
        }
        .callout-content label {
          --mdc-checkbox-unchecked-color: var(--light-gray);
          color: var(--light-gray);
          font-weight: bold;
          display: flex;
          align-items: center;
          margin-left: -16px;
        }
        .callout-content p {
          color: var(--light-gray);
          font-size: 12px;
          line-height: 16px;
          margin: 0;
        }
        label.city-button {
          padding: 28px 8px 11px 8px;
        }
      `,
    ];
  }

  render() {
    return html`
      <outline-step-view display-action="">
        <span slot="step-title">${this.localize('region-title')}</span>
        <span slot="step-description"
          >${this.localize('region-description')}</span
        >
        <div class="card-content" id="cityContainer">
          <div class="card-content-row">
            ${this.options.map((option, index) => {
              return html` <input
                  type="radio"
                  id="card-${index}"
                  name="city"
                  value="${index}"
                  ?disabled="${!option.available}"
                  .checked="${this.selectedIndex === index}"
                  @change="${this._locationSelected}"
                />
                <label for="card-${index}" class="city-button">
                  <div class="flag-overlay">
                    <img class="flag" src="${this._flagImage(option)}" />
                  </div>
                  <div class="geo-name">
                    ${getShortName(option.cloudLocation, this.localize)}
                  </div>
                  <div class="country-name">
                    ${option.cloudLocation.location?.countryIsRedundant()
                      ? ''
                      : localizeCountry(
                          option.cloudLocation.location,
                          this.language
                        )}
                  </div>
                  ${option.markedBestValue
                    ? html`<div class="best-value-label">
                        ${this.localize('region-best-value')}
                      </div>`
                    : ''}
                </label>`;
            })}
          </div>
          <div class="card-content-row">
            <if-messages
              message-ids="metrics-setup-title, metrics-setup-description, metrics-setup-learn-more"
              .localize=${this.localize}
            >
              <div class="callout">
                <iron-icon icon="editor:insert-chart"></iron-icon>
                <div class="callout-content">
                  <label>
                    <mwc-checkbox
                      .checked="${this.metricsEnabled}"
                      @change="${this._metricsToggle}"
                    ></mwc-checkbox>
                    ${this.localize('metrics-setup-title')}
                  </label>
                  <p>${this.localize('metrics-setup-description')}</p>
                  <a
                    href="https://support.google.com/outline/answer/15331222"
                  >
                    ${this.localize('metrics-setup-learn-more')}
                  </a>
                </div>
              </div>
            </if-messages>
          </div>
          <div class="card-content-row">
            <paper-button
              id="createServerButton"
              @tap="${this._handleCreateServerTap}"
              ?disabled="${!this._isCreateButtonEnabled(
                this.isServerBeingCreated,
                this.selectedIndex
              )}"
            >
              ${this.localize('region-setup')}
            </paper-button>
          </div>
        </div>
        ${this.isServerBeingCreated
          ? html`<paper-progress
              indeterminate=""
              class="slow"
            ></paper-progress>`
          : ''}
      </outline-step-view>
    `;
  }

  reset(): void {
    this.isServerBeingCreated = false;
    this.selectedIndex = -1;
  }

  _isCreateButtonEnabled(
    isCreatingServer: boolean,
    selectedIndex: number
  ): boolean {
    return !isCreatingServer && selectedIndex >= 0;
  }

  _locationSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    this.selectedIndex = Number.parseInt(inputEl.value, 10);
  }

  _metricsToggle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.metricsEnabled = checkbox.checked;
  }

  _flagImage(item: CloudLocationOption): string {
    const countryCode = item.cloudLocation.location?.countryCode?.toLowerCase();
    const fileName = countryCode ? `${countryCode}.svg` : 'unknown.png';
    return `${FLAG_IMAGE_DIR}/${fileName}`;
  }

  _handleCreateServerTap(): void {
    this.isServerBeingCreated = true;
    const selectedOption = this.options[this.selectedIndex];
    const params = {
      bubbles: true,
      composed: true,
      detail: {
        selectedLocation: selectedOption.cloudLocation,
        metricsEnabled: this.metricsEnabled,
      },
    };
    const customEvent = new CustomEvent('RegionSelected', params);
    this.dispatchEvent(customEvent);
  }
}
