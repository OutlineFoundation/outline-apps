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

import {LitElement, css, html} from 'lit';
import {customElement, state, query, property} from 'lit/decorators.js';

import '@material/mwc-icon';
import '@material/mwc-icon-button';

// TODO (#2384): this tooltip is implemented by javascript and not css due to api limitations in our current version of Electron.
// Once electron is updated, we should switch to the Popover API for better style control.

type TooltipPosition = 'bottom' | 'right' | 'left' | 'top';

@customElement('icon-tooltip')
export class IconTooltip extends LitElement {
  @property({type: String}) text?: string;
  @property({type: String}) icon: string = 'help';
  @property({type: String}) position: TooltipPosition = 'bottom';

  @state() tooltip?: HTMLElement;
  @query('mwc-icon-button') iconElement: HTMLElement;

  static styles = css`
    :host {
      --icon-tooltip-icon-size: 1.85rem;
      --icon-tooltip-button-size: 2rem;
      --icon-tooltip-icon-color: hsla(140, 3%, 77%, 1);

      color: var(--icon-tooltip-icon-color);
    }

    mwc-icon,
    mwc-icon-button {
      --mdc-icon-size: var(--icon-tooltip-icon-size);
    }

    mwc-icon-button {
      --mdc-icon-button-size: var(--icon-tooltip-button-size);
    }

    .tooltip-trigger {
      cursor: help;
      text-decoration: underline dotted;
      text-decoration-color: currentColor;
      text-underline-offset: 2px;
      display: inline;
    }
  `;

  render() {
    if (this.text === undefined) {
      return html`<mwc-icon>${this.icon}</mwc-icon>`;
    }

    // Check if slot has content
    const hasSlotContent = this.innerHTML.trim().length > 0;

    // If slot content exists, wrap that instead of showing icon button
    if (hasSlotContent) {
      return html`
        <span
          class="tooltip-trigger"
          @click=${this.insertTooltip}
          @blur=${this.removeTooltip}
          tabindex="0"
        >
          <slot></slot>
        </span>
      `;
    }

    return html`
      <mwc-icon-button
        @click=${this.insertTooltip}
        @blur=${this.removeTooltip}
        icon=${this.icon}
      >
      </mwc-icon-button>
    `;
  }

  insertTooltip(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (this.tooltip || this.text === undefined) {
      return;
    }

    this.tooltip = document.createElement('span');
    this.tooltip.innerHTML = this.text;

    const rect = this.iconElement.getBoundingClientRect();
    const positioning = this.calculatePosition(rect);

    // Since this element is created outside the custom element's scope,
    // we can't style it here and instead must inject the styles directly.
    // This too will be resolved by the Popover API
    this.tooltip.style.cssText = `
      display: inline-block;
      background-color: hsl(0, 0%, 94%);
      border-radius: 0.3rem;
      color: hsl(0, 0%, 20%);
      font-family: 'Inter', system-ui;
      max-width: 320px;
      ${positioning}
      padding: 0.3rem;
      position: fixed;
      white-space: pre-line;
      width: max-content;
      word-wrap: break-word;
      z-index: 1000;
    `;

    document.body.appendChild(this.tooltip);

    // TODO: sometimes the blur listener gives up when the user navigates away from the application
    // this ensures the tooltip is eventually removed - this will be solved by the Popover API
    setTimeout(this.removeTooltip, 5000);
  }

  private calculatePosition(rect: DOMRect): string {
    const spacing = 8;
    const tooltipMaxWidth = 320;
    let position = this.position;

    // Auto-adjust if tooltip would go off-screen
    if (
      position === 'right' &&
      rect.right + tooltipMaxWidth + spacing > window.innerWidth
    ) {
      position = 'left';
    }

    if (position === 'left' && rect.left - tooltipMaxWidth - spacing < 0) {
      position = 'right';
    }

    if (position === 'bottom' && rect.bottom + 100 > window.innerHeight) {
      position = 'top';
    }

    if (position === 'top' && rect.top - 100 < 0) {
      position = 'bottom';
    }

    switch (position) {
      case 'right':
        return `
          left: ${rect.right + spacing}px;
          top: ${rect.top + rect.height / 2}px;
          transform: translateY(-50%);
        `;

      case 'left':
        return `
          right: ${window.innerWidth - rect.left + spacing}px;
          top: ${rect.top + rect.height / 2}px;
          transform: translateY(-50%);
        `;

      case 'top':
        return `
          left: ${rect.left + rect.width / 2}px;
          bottom: ${window.innerHeight - rect.top + spacing}px;
          transform: translateX(-50%);
        `;

      case 'bottom':
      default:
        return `
          left: ${rect.left + rect.width / 2}px;
          top: ${rect.bottom + spacing}px;
          transform: translateX(-50%);
        `;
    }
  }

  removeTooltip() {
    this.tooltip?.remove();
    this.tooltip = undefined;
  }
}
