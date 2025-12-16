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
import '@polymer/paper-dialog/paper-dialog';
import '@polymer/paper-dropdown-menu/paper-dropdown-menu';
import '@polymer/paper-item/paper-item';
import '@polymer/paper-listbox/paper-listbox';
import '@polymer/paper-input/paper-input';
import '@polymer/paper-input/paper-textarea';
// This is needed to fix the "KeyframeEffect is not defined"
// see https://github.com/PolymerElements/paper-swatch-picker/issues/36
import 'web-animations-js/web-animations-next.min';

import {Polymer} from '@polymer/polymer/lib/legacy/polymer-fn';
import {html} from '@polymer/polymer/lib/utils/html-tag';

export interface OutlineFeedbackDialog extends Element {
  open(prepopulatedMessage?: string, showInstallationFailed?: boolean): void;
}

export interface FeedbackDetail {
  feedbackCategory: string;
  userFeedback: string;
  userEmail: string;
  cloudProvider?: string;
}

Polymer({
  _template: html`
    <style include="cloud-install-styles"></style>
    <style>
      :host {
        margin: 0px;
      }
      #feedbackWrapper {
        margin-top: 0;
      }

      /*
        This element is tricky to size.

        We need to constrain its height because paper-dialog doesn't handle things well when its
        height exceeds that of the page. max-rows isn't a reliable way to constrain the element's
        height because it does not consider line wrapping:
        https://github.com/PolymerElements/paper-input/issues/158

        By configuring a max-height and setting overflow-y:scroll on the paper-textarea we get its
        autogrow behaviour, at the cost of always showing a vertical scrollbar (even when there is
        just one line).
      */
      #userFeedback {
        max-height: 175px;
        overflow-x: hidden;
        overflow-y: scroll;
      }
      p a {
        color: var(--primary-green);
      }
      p.disclaimer {
        margin: 0;
        font-size: 12px;
      }
      paper-dropdown-menu {
        width: 100%;
      }
      paper-textarea {
        --iron-autogrow-textarea: {
          background: #eee;
        };
      }
      #feedbackExplanation {
        display: none;
      }
      .installationFailed #feedbackCategory {
        display: none;
      }
      .installationFailed #userFeedback {
        background-color: #eceff1;
        margin-top: 1em;
      }
      .installationFailed #feedbackExplanation {
        display: block;
      }
    </style>
    <paper-dialog id="dialog" modal="">
      <h2>[[title]]</h2>
      <div id="feedbackWrapper">
        <p id="feedbackExplanation">[[feedbackExplanation]]</p>
        <paper-dropdown-menu
          id="feedbackCategory"
          horizontal-align="left"
          on-selected-item-changed="feedbackCategoryChanged"
        >
          <paper-listbox
            id="feedbackCategoryListbox"
            slot="dropdown-content"
            class="dropdown-content"
          >
            <paper-item>[[localize('feedback-general')]]</paper-item>
            <paper-item>[[localize('feedback-install')]]</paper-item>
            <paper-item>[[localize('feedback-connection')]]</paper-item>
            <paper-item>[[localize('feedback-connection-others')]]</paper-item>
            <paper-item>[[localize('feedback-management')]]</paper-item>
            <paper-item>[[localize('feedback-suggestion')]]</paper-item>
          </paper-listbox>
        </paper-dropdown-menu>
        <paper-dropdown-menu
          id="cloudProvider"
          horizontal-align="left"
          placeholder="[[localize('feedback-cloud-provider')]]"
          hidden$="[[!shouldShowCloudProvider]]"
          error-message="[[localize('feedback-cloud-provider-error')]]"
        >
          <paper-listbox
            id="cloudProviderListbox"
            slot="dropdown-content"
            class="dropdown-content"
          >
            <paper-item>DigitalOcean</paper-item>
            <paper-item>Amazon Web Services</paper-item>
            <paper-item>Google Cloud Platform</paper-item>
            <paper-item>[[localize('feedback-other')]]</paper-item>
          </paper-listbox>
        </paper-dropdown-menu>
        <paper-input
          id="userEmail"
          type="text"
          placeholder="[[localize('feedback-email')]]"
          on-value-changed="userEmailValueChanged"
        ></paper-input>
        <p class="disclaimer" hidden$="[[!shouldShowLanguageDisclaimer]]">
          [[localize('feedback-disclaimer')]]
        </p>
        <paper-textarea
          id="userFeedback"
          type="text"
          label="[[localize('feedback-label')]]"
          always-float-label=""
          rows="4"
          error-message="[[localize('feedback-error')]]"
          on-value-changed="userFeedbackValueChanged"
        ></paper-textarea>
        <p
          inner-h-t-m-l="[[localize('feedback-privacy', 'openLink', '<a href=https://s3.amazonaws.com/outline-vpn/static_downloads/Outline-Data-Collection-Policy.html>', 'closeLink', '</a>')]]"
        ></p>
      </div>
      <!-- end of #feedbackWrapper -->
      <p class="buttons">
        <paper-button dialog-dismiss="">[[localize('cancel')]]</paper-button>
        <paper-button autofocus="" on-tap="submitTappedHandler"
          >[[localize('feedback-submit')]]</paper-button
        >
      </p>
    </paper-dialog>
  `,

  is: 'outline-feedback-dialog',

  properties: {
    title: String,
    feedbackExplanation: String,
    feedbackCategories: {
      type: Object,
      readOnly: true,
      value: {
        // Maps a category to its `feedbackCategoryListbox` item index.
        GENERAL: 0,
        INSTALLATION: 1,
        CONNECTION: 2,
        CONNECTION_OTHERS: 3,
        MANAGEMENT: 4,
        SUGGESTIONS: 5,
      },
    },
    hasEnteredEmail: {
      type: Boolean,
      value: false,
    },
    shouldShowCloudProvider: {
      type: Boolean,
      value: false,
    },
    shouldShowLanguageDisclaimer: {
      type: Boolean,
      computed: '_computeShouldShowLanguageDisclaimer(hasEnteredEmail)',
    },
    localize: {
      type: Function,
    },
  },

  open(prepopulatedMessage: string, showInstallationFailed: boolean) {
    // The localized category doesn't get displayed the first time opening the
    // dialog (or after updating language) because the selected list item won't
    // notice the localization change.
    // This is a known issue and here is a workaround (force the selected item change):
    //   https://github.com/PolymerElements/paper-dropdown-menu/issues/159#issuecomment-229958448
    this.$.feedbackCategoryListbox.selected = undefined;

    // Clear all fields, in case feedback had already been entered.
    if (showInstallationFailed) {
      this.title = this.localize('feedback-title-install');
      this.feedbackExplanation = this.localize('feedback-explanation-install');
      this.$.dialog.classList.add('installationFailed');
      this.$.feedbackCategoryListbox.selected =
        this.feedbackCategories.INSTALLATION;
    } else {
      this.title = this.localize('feedback-title-generic');
      this.feedbackExplanation = '';
      this.$.dialog.classList.remove('installationFailed');
      this.$.feedbackCategoryListbox.selected = this.feedbackCategories.GENERAL;
    }
    this.$.userFeedback.invalid = false;
    this.$.userFeedback.value = prepopulatedMessage || '';
    this.$.userEmail.value = '';
    this.$.cloudProviderListbox.selected = undefined;
    this.$.dialog.open();
  },

  submitTappedHandler() {
    // Verify that userFeedback is entered.
    if (!this.$.userFeedback.value) {
      this.$.userFeedback.invalid = true;
      return;
    }
    const data: FeedbackDetail = {
      feedbackCategory: this.$.feedbackCategory.selectedItemLabel,
      userFeedback: this.$.userFeedback.value,
      userEmail: this.$.userEmail.value,
    };
    const selectedCloudProvider = this.$.cloudProvider.selectedItemLabel;
    if (this.shouldShowCloudProvider && !!selectedCloudProvider) {
      data.cloudProvider = selectedCloudProvider;
    }
    this.fire('SubmitFeedback', data);
    this.$.dialog.close();
  },

  userEmailValueChanged() {
    this.hasEnteredEmail = !!this.$.userEmail.value;
  },

  feedbackCategoryChanged() {
    const selectedCategory = this.$.feedbackCategoryListbox.selected;
    if (
      selectedCategory === this.feedbackCategories.INSTALLATION ||
      selectedCategory === this.feedbackCategories.CONNECTION ||
      selectedCategory === this.feedbackCategories.CONNECTION_OTHERS
    ) {
      this.shouldShowCloudProvider = true;
    } else {
      this.shouldShowCloudProvider = false;
    }
    this.$.dialog.notifyResize();
  },

  userFeedbackValueChanged() {
    // Hides any error message when the user starts typing feedback.
    this.$.userFeedback.invalid = false;

    // Make the paper-dialog (vertically) re-center.
    this.$.dialog.notifyResize();
  },

  // Returns whether the window's locale is English (i.e. EN, en-US) and the user has
  // entered their email.
  _computeShouldShowLanguageDisclaimer(hasEnteredEmail: boolean) {
    return !window.navigator.language.match(/^en/i) && hasEnteredEmail;
  },
});
