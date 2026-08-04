/**
 * Copyright 2023 The Outline Authors
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

import {TextArea} from '@material/mwc-textarea';
import {TextField} from '@material/mwc-textfield';

import '@material/mwc-button';
import '@material/mwc-textarea';
import '@material/mwc-textfield';
import {Localizer} from '@outline/infrastructure/i18n';
import {html, css, LitElement, PropertyValues} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';
import {createRef, Ref, ref} from 'lit/directives/ref.js';

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Interface for tracking form data. */
export declare interface FormValues {
  email?: string;
  description: string;
}

@customElement('support-form')
export class SupportForm extends LitElement {
  static styles = [
    css`
      :host {
        --md-sys-color-primary: var(--outline-primary);
        --md-sys-color-on-surface: var(--outline-text-color);
        --md-sys-color-surface: var(--outline-card-background);

        font-family: var(--outline-font-family);
        width: 100%;
        color: var(--outline-text-color);
      }

      mwc-textarea,
      mwc-textfield {
        display: flex;
        margin: var(--outline-slim-gutter) 0;
        --mdc-text-field-ink-color: var(--outline-text-color);
        --mdc-text-field-label-ink-color: var(--outline-label-color);
        --mdc-text-field-fill-color: var(--outline-input-bg);
        --mdc-text-field-disabled-fill-color: var(--outline-input-bg);
        --mdc-text-field-disabled-ink-color: var(--outline-label-color);
      }

      mwc-button {
        --mdc-theme-primary: var(--outline-primary);
        --mdc-theme-on-primary: var(--outline-card-background);
      }

      .actions {
        display: flex;
        justify-content: end;
      }
    `,
  ];

  /** The default maximum character length of input fields. */
  private static readonly DEFAULT_MAX_LENGTH_INPUT = 225;
  /** The maximum character length of the "Description" field. */
  private static readonly MAX_LENGTH_DESCRIPTION = 131072;
  /** The number of visible text lines for the "Description" field. */
  private static readonly MAX_ROWS_DESCRIPTION = 5;

  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: Boolean}) disabled = false;
  @property({type: Object}) values: Partial<FormValues> = {};

  private readonly formRef: Ref<HTMLFormElement> = createRef();
  @state() valid = false;

  override updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);

    if (changedProperties.has('values')) {
      queueMicrotask(() => this.checkFormValidity());
    }
  }

  /** Checks the entire form's validity state. */
  private checkFormValidity() {
    // The form ref is unset while the element is disconnected (e.g. when the
    // host swaps the form out for a progress spinner during submission), but a
    // queued validity check may still fire. Bail out rather than throwing.
    if (!this.formRef.value) {
      return;
    }
    const fieldNodes =
      this.formRef.value.querySelectorAll<FormControl>('*[name]');
    this.valid = Array.from(fieldNodes).every(field => field.validity.valid);
  }

  /** Cancels the form. */
  private cancel(e: PointerEvent) {
    e.stopPropagation();

    const event = new CustomEvent<boolean>('cancel', {detail: true});
    this.dispatchEvent(event);
  }

  /** Submits the form. */
  private submit(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();

    const event = new CustomEvent<boolean>('submit', {detail: true});
    this.dispatchEvent(event);
  }

  private handleInput(e: InputEvent) {
    const target = e.target as HTMLInputElement;
    const key = target.name as keyof FormValues;
    if (target instanceof TextField || target instanceof TextArea) {
      const {value} = target;
      (this.values as Record<string, string>)[key] = value;
    } else {
      throw new Error(`Cannot handle unknown form field: ${key}`);
    }
    this.checkFormValidity();
  }

  render() {
    return html`
      <form ${ref(this.formRef)} @submit=${this.submit}>
        <mwc-textfield
          name="email"
          type="email"
          .label=${this.localize('support-form-email')}
          .value=${live(this.values.email ?? '')}
          .maxLength=${SupportForm.DEFAULT_MAX_LENGTH_INPUT}
          autoValidate
          .validationMessage=${this.localize('support-form-email-invalid')}
          .disabled=${this.disabled}
          @input=${this.handleInput}
          @blur=${this.checkFormValidity}
        ></mwc-textfield>

        <mwc-textarea
          name="description"
          .label=${this.localize('support-form-description')}
          .value=${live(this.values.description ?? '')}
          .rows=${SupportForm.MAX_ROWS_DESCRIPTION}
          .maxLength=${SupportForm.MAX_LENGTH_DESCRIPTION}
          .disabled=${this.disabled}
          required
          @input=${this.handleInput}
          @blur=${this.checkFormValidity}
        >
        </mwc-textarea>

        <span class="actions">
          <mwc-button
            .label=${this.localize('cancel')}
            .disabled=${this.disabled}
            @click=${this.cancel}
          ></mwc-button>
          <mwc-button
            type="submit"
            .label=${this.localize('submit')}
            .disabled=${!this.valid || this.disabled}
            @click=${this.submit}
          ></mwc-button>
        </span>
      </form>
    `;
  }
}
