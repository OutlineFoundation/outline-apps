// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import './outline-gcp-create-server-app';

import {GcpCreateServerApp} from './outline-gcp-create-server-app';

// Exposes the component's private state so the tests can drive it to a page
// without a real GCP account.
type TestableGcpCreateServerApp = GcpCreateServerApp & {
  currentPage: string;
  isProjectBeingCreated: boolean;
};

describe('GcpCreateServerApp', () => {
  // Every fake translation is distinct from the English text the component
  // used to hardcode, so an assertion only passes when the string actually
  // comes from localize().
  const localize = (msgId: string) => `[localized:${msgId}]`;

  let el: TestableGcpCreateServerApp;
  beforeEach(async () => {
    el = document.createElement(
      'outline-gcp-create-server-app'
    ) as TestableGcpCreateServerApp;
    el.localize = localize;
    el.language = 'en';
    document.body.appendChild(el);
    await el.updateComplete;
  });
  afterEach(() => {
    el.remove();
  });

  describe('project setup step', () => {
    beforeEach(async () => {
      el.currentPage = 'projectSetup';
      await el.updateComplete;
    });

    it('renders every string through localize()', () => {
      const text = el.shadowRoot.textContent;
      expect(text).toContain('[localized:gcp-create-server]');
      expect(text).toContain('[localized:gcp-create-server-description]');
      expect(text).toContain('[localized:gcp-create-server-name-project]');
      expect(text).toContain('[localized:gcp-create-server-choose-billing]');
      expect(text).toContain('[localized:gcp-create-project]');
      expect(text).not.toMatch(/[A-Za-z]{2,}\s+[A-Za-z]{2,}/);
    });

    it('localizes the project ID input label', () => {
      // paper-input renders its label in its own shadow root, so check the
      // attribute rather than the flattened text.
      const input = el.shadowRoot.querySelector('#projectName');
      expect(input.getAttribute('label')).toBe(
        '[localized:gcp-create-server-project-id]'
      );
    });

    it('renders a localized, disabled button while the project is created', async () => {
      el.isProjectBeingCreated = true;
      await el.updateComplete;
      const button = el.shadowRoot.querySelector('paper-button');
      expect(button.textContent).toContain(
        '[localized:gcp-create-server-in-progress]'
      );
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(el.shadowRoot.querySelector('#createServerButton')).toBeNull();
    });
  });

  describe('billing account setup step', () => {
    it('renders every string through localize()', async () => {
      el.currentPage = 'billingAccountSetup';
      await el.updateComplete;
      const text = el.shadowRoot.textContent;
      expect(text).toContain('[localized:gcp-billing-title]');
      expect(text).toContain('[localized:gcp-billing-description]');
      expect(text).toContain('[localized:gcp-billing-action]');
      expect(text).toContain('[localized:gcp-billing-body]');
    });
  });
});
