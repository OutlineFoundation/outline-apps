/**
 * Copyright 2024 The Outline Authors
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

import '@material/mwc-circular-progress';
import '@material/mwc-radio';
import '@material/mwc-select';
import '@material/mwc-formfield';
import '@polymer/paper-dialog/paper-dialog';
import {SingleSelectedEvent} from '@material/mwc-list/mwc-list';
import {Radio} from '@material/mwc-radio';

import {Localizer} from '@outline/infrastructure/i18n';
import {PaperDialogElement} from '@polymer/paper-dialog/paper-dialog';
import '@polymer/paper-button/paper-button';
import * as Sentry from '@sentry/electron/renderer';
import {html, css, LitElement, TemplateResult, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {Ref, createRef, ref} from 'lit/directives/ref.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import {COMMON_STYLES} from './cloud-install-styles';
import {OutlineFeedbackDialog} from './outline-feedback-dialog';
import './outline-support-form';
import {FormValues, OutlineSupportForm} from './outline-support-form';

/** The possible steps in the stepper. Only one step is shown at a time. */
enum ProgressStep {
  ISSUE_WIZARD, // Step to ask for their specific issue.
  FORM, // The contact form.
  EXIT, // Final message to show, if any.
}

/** Supported issue types in the feedback flow. */
enum IssueType {
  CANNOT_ADD_SERVER = 'cannot-add-server',
  CONNECTION = 'connection',
  MANAGING = 'managing',
  GENERAL = 'general',
}

/** A map of unsupported issue types to helppage URLs to redirect users to. */
const UNSUPPORTED_ISSUE_TYPE_HELPPAGES = new Map([
  [
    IssueType.CANNOT_ADD_SERVER,
    'https://support.google.com/outline/answer/15331223',
  ],
  [
    IssueType.CONNECTION,
    'https://support.google.com/outline/answer/15331126',
  ],
]);

@customElement('outline-contact-us-dialog')
export class OutlineContactUsDialog
  extends LitElement
  implements OutlineFeedbackDialog
{
  static get styles() {
    return [
      COMMON_STYLES,
      css`
        :host {
          --mdc-theme-primary: var(--primary-green);
          --mdc-theme-text-primary-on-background: rgba(0, 0, 0, 0.54);
        }

        paper-dialog {
          width: 80%;
          overflow-y: scroll;
        }

        main {
          display: block;
          margin-left: auto;
          margin-right: auto;
        }

        mwc-circular-progress {
          left: 50%;
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
        }

        p {
          margin-top: .25rem;
        }

        ol {
          list-style-type: none;
          margin: 1.5rem 0;
          padding-inline-start: 0;
        }

        mwc-select {
          margin-top: 1rem;
          width: 100%;
        }

        mwc-select[hidden] {
          display: none;
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
        }

        mwc-list-item span {
          white-space: normal;
        }

        fieldset {
          border: none;
        }
      }
    `,
    ];
  }

  private readonly dialogRef: Ref<PaperDialogElement> = createRef();

  private static readonly ISSUES: IssueType[] = [
    IssueType.CANNOT_ADD_SERVER,
    IssueType.CONNECTION,
    IssueType.MANAGING,
    IssueType.GENERAL,
  ];

  @property({type: Function}) localize: Localizer = msg => msg;

  @state() private installationFailed = false;

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
  private readonly formRef: Ref<OutlineSupportForm> = createRef();
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
    this.selectedIssueType = OutlineContactUsDialog.ISSUES[e.detail.index];

    if (UNSUPPORTED_ISSUE_TYPE_HELPPAGES.has(this.selectedIssueType)) {
      // TODO: Send users to localized support pages based on chosen language.
      this.exitTemplate = this.localizeWithUrl(
        `contact-view-exit-${this.selectedIssueType}`,
        UNSUPPORTED_ISSUE_TYPE_HELPPAGES.get(this.selectedIssueType)
      );
      this.currentStep = ProgressStep.EXIT;
      return;
    }

    this.currentStep = ProgressStep.FORM;
  }

  reset() {
    if (this.installationFailed) {
      this.close();
    }
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
      Sentry.captureEvent({
        message: description,
        user: {email},
        tags: {
          category: this.selectedIssueType?.toString() ?? 'unknown',
          isFeedback: true,
          formVersion: 2,
          ...tags,
        },
      });
    } catch (e) {
      console.error(`Failed to send feedback report: ${e.message}`);
      this.isFormSubmitting = false;
      this.dispatchEvent(new CustomEvent('error'));
      return;
    }

    this.isFormSubmitting = false;
    this.reset();
    this.close();
    this.dispatchEvent(new CustomEvent('success'));
  }

  // TODO: Consider moving this functionality to a more centralized place for re-use.
  private localizeWithUrl(messageID: string, url: string): TemplateResult {
    const openLink = `<a href="${url}" target="_blank">`;
    const closeLink = '</a>';
    return html`
      ${unsafeHTML(
        this.localize(messageID, 'openLink', openLink, 'closeLink', closeLink)
      )}
    `;
  }

  private get renderIntroTemplate(): TemplateResult {
    const introMsg = this.installationFailed
      ? this.localize('feedback-explanation-install')
      : this.localize('contact-view-intro');
    return html` <p class="intro">${introMsg}</p> `;
  }

  private get renderForm(): TemplateResult | typeof nothing {
    if (this.isFormSubmitting) {
      return html`
        <mwc-circular-progress indeterminate></mwc-linear-progress>
      `;
    }
    return html`
      <outline-support-form
        ${ref(this.formRef)}
        .localize=${this.localize}
        .disabled=${this.isFormSubmitting}
        .values=${this.formValues}
        @cancel=${this.reset}
        @submit=${this.submitForm}
      ></outline-support-form>
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
                    <mwc-radio
                      name="open-ticket"
                      .value="${element.value}"
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
            ${OutlineContactUsDialog.ISSUES.map(value => {
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
    const titleMsg = this.installationFailed
      ? this.localize('feedback-title-install')
      : this.localize('nav-contact-us');
    return html`
      <paper-dialog ${ref(this.dialogRef)} modal="">
        <h2>${titleMsg}</h2>
        <main>${this.renderMainContent}</main>
        ${this.currentStep === ProgressStep.FORM
          ? nothing
          : html`
              <fieldset class="buttons">
                <paper-button dialog-dismiss=""
                  >${this.localize('cancel')}</paper-button
                >
              </fieldset>
            `}
      </paper-dialog>
    `;
  }

  open(prepopulatedMessage: string, showInstallationFailed: boolean) {
    // Clear all fields, in case feedback had already been entered.
    this.reset();

    this.installationFailed = showInstallationFailed;
    if (this.installationFailed) {
      // We go straight to the form and bypass the wizard in the case of a failed
      // installation.
      this.currentStep = ProgressStep.FORM;
      this.selectedIssueType = IssueType.GENERAL;
      this.formValues.description = prepopulatedMessage;
    }

    this.dialogRef.value?.open();
  }

  close() {
    this.dialogRef.value?.close();
  }
}
