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

import {fixture, html, nextFrame, oneEvent} from '@open-wc/testing';

import {ContactView} from './index';
import {SupportForm} from './support_form';
import {
  OutlineErrorReporter,
  SentryErrorReporter,
} from '../../shared/error_reporter';
import {localize} from '../../testing/localize';

describe('ContactView', () => {
  const ISSUE_TYPES = [
    'cannot-add-server',
    'connection',
    'performance',
    'general',
  ];

  let el: ContactView;
  let mockErrorReporter: jasmine.SpyObj<OutlineErrorReporter>;

  beforeEach(async () => {
    mockErrorReporter = jasmine.createSpyObj(
      'SentryErrorReporter',
      Object.getOwnPropertyNames(SentryErrorReporter.prototype)
    );
    el = await fixture(html`
      <contact-view
        .localize=${localize}
        .errorReporter=${mockErrorReporter}
      ></contact-view>
    `);
    await nextFrame();
  });

  it('is defined', async () => {
    expect(el).toBeInstanceOf(ContactView);
  });

  it('shows the issue selector', () => {
    const issueSelector = el.shadowRoot?.querySelector('mwc-select');
    expect(issueSelector).not.toBeNull();
  });

  it('shows the correct items in the selector', () => {
    const issueSelector = el.shadowRoot!.querySelector('mwc-select')!;
    const issueItemEls = issueSelector.querySelectorAll('mwc-list-item');
    const issueTypes = Array.from(issueItemEls).map(
      el => (el as {value: string}).value
    );
    expect(issueTypes).toEqual(ISSUE_TYPES);
  });

  it('shows the support form', () => {
    const supportForm = el.shadowRoot!.querySelector('support-form');
    expect(supportForm).not.toBeNull();
  });

  describe('when the support form is submitted', () => {
    let supportForm: SupportForm;

    beforeEach(async () => {
      supportForm = el.shadowRoot!.querySelector('support-form')!;
      supportForm.values.email = 'foo@bar.com';
      supportForm.values.description = 'Test Description';
      supportForm.valid = true;
    });

    it('reports the default "general" category when no issue is selected', async () => {
      supportForm.dispatchEvent(new CustomEvent('submit'));
      await nextFrame();

      expect(mockErrorReporter.sendFeedback).toHaveBeenCalledWith(
        'Test Description',
        'general',
        'foo@bar.com',
        {
          formVersion: 2,
        }
      );
    });

    it('reports the selected category', async () => {
      const issueSelector = el.shadowRoot!.querySelector('mwc-select')!;
      issueSelector.dispatchEvent(
        new CustomEvent('selected', {
          detail: {index: ISSUE_TYPES.indexOf('connection')},
        })
      );
      await nextFrame();

      supportForm.dispatchEvent(new CustomEvent('submit'));
      await nextFrame();

      expect(mockErrorReporter.sendFeedback).toHaveBeenCalledWith(
        'Test Description',
        'connection',
        'foo@bar.com',
        {
          formVersion: 2,
        }
      );
    });

    it('emits success event on completion of support form', async () => {
      const listener = oneEvent(el, 'success');

      supportForm.dispatchEvent(new CustomEvent('submit'));

      const {detail} = await listener;
      expect(detail).toBeNull();
    });

    it('emits failure event when feedback reporting fails', async () => {
      const listener = oneEvent(el, 'error');
      mockErrorReporter.sendFeedback.and.throwError('fail');

      supportForm.dispatchEvent(new CustomEvent('submit'));

      const {detail} = await listener;
      expect(detail).toBeNull();
    });
  });
});
