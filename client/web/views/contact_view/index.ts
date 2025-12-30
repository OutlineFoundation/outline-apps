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

import {SingleSelectedEvent} from '@material/mwc-list/mwc-list';
import {Radio} from '@material/mwc-radio';
import '@material/mwc-circular-progress';
import '@material/mwc-radio';
import '@material/mwc-select';
import '@material/mwc-formfield';

import {Localizer} from '@outline/infrastructure/i18n';
import {html, css, LitElement, TemplateResult, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {Ref, createRef, ref} from 'lit/directives/ref.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import './support_form';
import {FormValues, SupportForm} from './support_form';
import {OutlineErrorReporter} from '../../shared/error_reporter';

/** The possible steps in the stepper. Only one step is shown at a time. */
enum ProgressStep {
  ISSUE_WIZARD, // Step to ask for their specific issue.
  FORM, // The contact form.
  EXIT, // Final message to show, if any.
}

/** Supported issue types in the feedback flow. */
enum IssueType {
  NO_SERVER = 'no-server',
  CANNOT_ADD_SERVER = 'cannot-add-server',
  BILLING = 'billing',
  CONNECTION = 'connection',
  PERFORMANCE = 'performance',
  GENERAL = 'general',
}

/** A map of unsupported issue types to helppage URLs to redirect users to. */
const UNSUPPORTED_ISSUE_TYPES = new Map([
  [IssueType.NO_SERVER, 'https://support.google.com/outline/answer/15331628'],
  [
    IssueType.CANNOT_ADD_SERVER,
    'https://support.google.com/outline/answer/15331223',
  ],
  [IssueType.BILLING, null],
  [IssueType.CONNECTION, 'https://support.google.com/outline/answer/15331126'],
]);

@customElement('contact-view')
export class ContactView extends LitElement {
  static styles = [
    css`
      :host {
        background: var(--outline-background);
        color: var(--outline-text-color);
        font-family: var(--outline-font-family);
        padding: var(--contact-view-gutter, var(--outline-gutter));
        width: 100%;
      }

      main {
        display: block;
        margin-left: auto;
        margin-right: auto;
        max-width: var(--contact-view-max-width);
      }

      mwc-circular-progress {
        left: 50%;
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
      }

      p {
        margin-top: 0.25rem;
      }

      ol {
        list-style-type: none;
        margin: 1.5rem 0;
        padding-inline-start: 0;
        color: var(--outline-text-color);
      }

      mwc-select {
        /**
         * The '<app-header-layout>' restricts the stacking context, which means
         * the select dropdown will get stacked underneath the header.
         * See https://github.com/PolymerElements/app-layout/issues/279. Setting
         * a maximum height will make the dropdown small enough to not run into
         * this issue.
         */
        --mdc-menu-max-height: 200px;
        --mdc-menu-max-width: min(
          calc(100vw - calc(var(--outline-gutter) * 4)),
          var(--contact-view-max-width)
        );
        margin-top: 1rem;
        max-width: var(--contact-view-max-width);
        width: 100%;
        --mdc-theme-primary: var(--outline-primary);
        --mdc-select-ink-color: var(--outline-text-color);
        --mdc-select-label-ink-color: var(--outline-label-color);
        --mdc-select-dropdown-icon-color: var(--outline-text-color);
        --mdc-select-hover-line-color: var(--outline-text-color);
        --mdc-select-fill-color: rgba(0, 0, 0, 0.08);
        --mdc-menu-surface-fill-color: var(--outline-card-background);
        --mdc-theme-surface: var(--outline-card-background);
        border: 1px solid var(--outline-hairline);
        border-radius: 4px;
        padding: 4px 0;
        margin-top: 16px;
      }

      mwc-select[hidden] {
        display: none;
      }

      /* Style the dropdown list */
      mwc-select mwc-menu {
        --mdc-theme-surface: var(--outline-background);
      }

      /* Style the list items properly for dark mode */
      mwc-select mwc-list-item {
        background-color: var(--outline-background);
      }

      mwc-list-item {
        line-height: 1.25rem;
        /**
         * The default styling of list items that wrap to 3+ lines is bad, and
         * our items here are quite long and tend to wrap that much. To allow
         * all lines to take up as much space as they can, we set the height to
         * "auto", with a min-height of what the height would have been, which
         * defaults to "48px" (https://www.npmjs.com/package/@material/mwc-menu#css-custom-properties).
         */
        min-height: 48px;
        --mdc-menu-item-height: auto;
        padding-bottom: var(--outline-mini-gutter);
        padding-top: var(--outline-mini-gutter);
        color: var(--outline-text-color);
        --mdc-theme-text-primary-on-background: var(--outline-text-color);
        background-color: var(--outline-background);
        padding: 8px 16px;
      }

      mwc-list-item span {
        white-space: normal;
        color: var(--outline-text-color);
        display: block;
        width: 100%;
      }

      /* Fix radio buttons */
      mwc-radio {
        --mdc-theme-secondary: var(--outline-primary);
        --mdc-radio-unchecked-color: var(--outline-text-color);
        --mdc-radio-unchecked-color: var(--outline-text-color);
        --mdc-theme-secondary: var(--outline-primary);
        --mdc-radio-disabled-color: var(--outline-label-color);
        border-color: var(--outline-text-color);
      }

      mwc-formfield {
        color: var(--outline-text-color);
        --mdc-theme-text-primary-on-background: var(--outline-text-color);
      }

      .formfield {
        color: var(--outline-text-color);
        --mdc-theme-text-primary-on-background: var(--outline-text-color);
        font-weight: normal;
        padding: 8px 0;
      }

      /* Style links for better visibility in dark mode */
      a {
        color: var(--outline-primary);
        text-decoration: none;
      }
    `,
  ];

  private static readonly ISSUES: IssueType[] = [
    IssueType.NO_SERVER,
    IssueType.CANNOT_ADD_SERVER,
    IssueType.BILLING,
    IssueType.CONNECTION,
    IssueType.PERFORMANCE,
    IssueType.GENERAL,
  ];

  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: String}) languageCode = '';
  @property({type: Object, attribute: 'error-reporter'})
  errorReporter: OutlineErrorReporter;

  @state() private currentStep: ProgressStep = ProgressStep.ISSUE_WIZARD;
  private selectedIssueType?: IssueType;
  private exitTemplate?: TemplateResult;

  private readonly openTicketSelectionOptions: Array<{
    ref: Ref<Radio>;
    value: boolean;
    labelMsg: string;
  }> = [
    {
      ref: createRef(),
      value: true,
      labelMsg: 'yes',
    },
    {
      ref: createRef(),
      value: false,
      labelMsg: 'no',
    },
  ];

  @state() private showIssueSelector = false;
  private formValues: Partial<FormValues> = {};
  private readonly formRef: Ref<SupportForm> = createRef();
  @state() private isFormSubmitting = false;

  private selectHasOpenTicket(e: InputEvent) {
    const radio = e.target as Radio;
    const hasOpenTicket = radio.value;
    if (hasOpenTicket) {
      this.exitTemplate = html`${this.localize(
        'contact-view-exit-open-ticket'
      )}`;
      this.currentStep = ProgressStep.EXIT;
      return;
    }
    this.showIssueSelector = true;
  }

  private selectIssue(e: SingleSelectedEvent) {
    this.selectedIssueType = ContactView.ISSUES[e.detail.index];

    if (UNSUPPORTED_ISSUE_TYPES.has(this.selectedIssueType)) {
      const helpPage = UNSUPPORTED_ISSUE_TYPES.get(this.selectedIssueType);
      if (helpPage) {
        this.exitTemplate = this.localizeWithUrl(
          `contact-view-exit-${this.selectedIssueType}`,
          helpPage
        );
      } else {
        this.exitTemplate = html`${this.localize(
          `contact-view-exit-${this.selectedIssueType}`
        )}`;
      }
      this.currentStep = ProgressStep.EXIT;
      return;
    }

    this.currentStep = ProgressStep.FORM;
  }

  reset() {
    this.isFormSubmitting = false;
    this.showIssueSelector = false;
    this.openTicketSelectionOptions.forEach(element => {
      if (!element.ref.value) return;
      element.ref.value.checked = false;
    });
    this.currentStep = ProgressStep.ISSUE_WIZARD;
    this.formValues = {};
  }

  private async submitForm() {
    this.isFormSubmitting = true;

    if (!this.formRef.value.valid) {
      throw Error('Cannot submit invalid form.');
    }

    const {description, email, ...tags} = this.formValues as FormValues;
    try {
      await this.errorReporter.report(
        description,
        this.selectedIssueType?.toString() ?? 'unknown',
        email,
        {
          ...tags,
          formVersion: 2,
        }
      );
    } catch (e) {
      console.error(`Failed to send feedback report: ${e.message}`);
      this.isFormSubmitting = false;
      this.dispatchEvent(new CustomEvent('error'));
      return;
    }

    this.isFormSubmitting = false;
    this.reset();
    this.dispatchEvent(new CustomEvent('success'));
  }

  private localizeWithUrl(messageID: string, url: string): TemplateResult {
    const parsedUrl = new URL(url);
    if (this.languageCode) {
      parsedUrl.searchParams.append('language', this.languageCode);
    }
    const openLink = `<a href="${parsedUrl.toString()}" target="_blank">`;
    const closeLink = '</a>';
    return html`
      ${unsafeHTML(
        this.localize(messageID, 'openLink', openLink, 'closeLink', closeLink)
      )}
    `;
  }

  private get renderIntroTemplate(): TemplateResult {
    return html`<p class="intro">${this.localize('contact-view-intro')}</p>`;
  }

  private get renderForm(): TemplateResult | typeof nothing {
    if (this.isFormSubmitting) {
      return html`
        <mwc-circular-progress indeterminate></mwc-circular-progress>
      `;
    }
    return html`
      <support-form
        ${ref(this.formRef)}
        .localize=${this.localize}
        .disabled=${this.isFormSubmitting}
        .values=${this.formValues}
        @cancel=${this.reset}
        @submit=${this.submitForm}
      ></support-form>
    `;
  }

  private get renderMainContent(): TemplateResult {
    switch (this.currentStep) {
      case ProgressStep.FORM: {
        return html` ${this.renderIntroTemplate} ${this.renderForm} `;
      }

      case ProgressStep.EXIT: {
        return html` <p class="exit">${this.exitTemplate}</p>`;
      }

      case ProgressStep.ISSUE_WIZARD:
      default: {
        return html`
          ${this.renderIntroTemplate}

          <p>${this.localize('contact-view-open-ticket')}</p>

          <ol>
            ${this.openTicketSelectionOptions.map(
              element => html`
                <li>
                  <mwc-formfield .label=${this.localize(element.labelMsg)}>
                    <!-- mwc-radio's 'value' attribute is incorrectly typed as a string - if you pass a string, it breaks -->
                    <mwc-radio
                      name="open-ticket"
                      .value="${element.value as unknown as string}"
                      required
                      @change=${this.selectHasOpenTicket}
                      ${ref(element.ref)}
                    >
                    </mwc-radio>
                  </mwc-formfield>
                </li>
              `
            )}
          </ol>

          <mwc-select
            .label=${this.localize('contact-view-issue')}
            ?hidden=${!this.showIssueSelector}
            ?fixedMenuPosition=${true}
            @selected="${this.selectIssue}"
          >
            ${ContactView.ISSUES.map(value => {
              return html`
                <mwc-list-item value="${value}">
                  <span>${this.localize(`contact-view-issue-${value}`)}</span>
                </mwc-list-item>
              `;
            })}
          </mwc-select>
        `;
      }
    }
  }

  render() {
    return html`<main>${this.renderMainContent}</main>`;
  }
}
