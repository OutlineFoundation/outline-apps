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

import {ListItemBase} from '@material/mwc-list/mwc-list-item-base';
import {Select} from '@material/mwc-select';

import {fixture, html, nextFrame, oneEvent} from '@open-wc/testing';

import {ContactView} from './index';
import {SupportForm} from './support_form';
import {
  OutlineErrorReporter,
  SentryErrorReporter,
} from '../../shared/error_reporter';
import {localize} from '../../testing/localize';

describe('ContactView', () => {
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
  });

  it('is defined', async () => {
    expect(el).toBeInstanceOf(ContactView);
  });

  it('hides issue selector by default', async () => {
    const issueSelector = el.shadowRoot?.querySelector('mwc-select');
    expect(issueSelector?.hasAttribute('hidden')).toBeTrue();
  });

  it('hides support form by default', async () => {
    const supportForm = el.shadowRoot?.querySelector('support-form');
    expect(supportForm).toBeNull();
  });

  it('shows exit message if the user selects that they have an open ticket', async () => {
    const radioButton = el.shadowRoot!.querySelectorAll(
      'mwc-formfield mwc-radio'
    )[0] as HTMLElement;
    radioButton.click();
    await nextFrame();

    const exitCard = el.shadowRoot!.querySelector('.exit')!;
    expect(exitCard.textContent).toContain('experiencing high support volume');
  });

  it('resets the view on `reset()`', async () => {
    const radioButton = el.shadowRoot!.querySelectorAll(
      'mwc-formfield mwc-radio'
    )[0] as HTMLElement;
    radioButton.click();
    await nextFrame();

    el.reset();
    await nextFrame();

    const exitCard = el.shadowRoot!.querySelector('.exit')!;
    expect(exitCard).toBeNull();
  });

  describe('when the user selects that they have no open tickets', () => {
    let issueSelector: Select;

    beforeEach(async () => {
      const radioButton = el.shadowRoot!.querySelectorAll(
        'mwc-formfield mwc-radio'
      )[1] as HTMLElement;
      radioButton.click();
      await nextFrame();

      issueSelector = el.shadowRoot!.querySelector('mwc-select')!;
    });

    it('shows the issue selector', () => {
      expect(issueSelector.hasAttribute('hidden')).toBeFalse();
    });

    it('shows the correct items in the selector', () => {
      const issueItemEls = issueSelector.querySelectorAll('mwc-list-item');
      const issueTypes = Array.from(issueItemEls).map(
        (el: ListItemBase) => el.value
      );
      expect(issueTypes).toEqual([
        'no-server',
        'cannot-add-server',
        'billing',
        'connection',
        'performance',
        'general',
      ]);
    });
  });

  describe('when the user selects issue', () => {
    let issueSelector: Select;

    beforeEach(async () => {
      issueSelector = el.shadowRoot!.querySelector('mwc-select')!;
      const radioButton = el.shadowRoot!.querySelectorAll(
        'mwc-formfield mwc-radio'
      )[1] as HTMLElement;
      radioButton.click();
      await nextFrame();
    });

    const conditions = [
      {
        testcaseName: 'I need an access key',
        value: 'no-server',
        expectedMsg: 'does not distribute free or paid access keys',
      },
      {
        testcaseName: 'I am having trouble adding a server using my access key',
        value: 'cannot-add-server',
        expectedMsg: 'assist with adding a server',
      },
      {
        testcaseName: 'I need assistance with a billing or subscription issue',
        value: 'billing',
        expectedMsg: 'does not collect payment',
      },
      {
        testcaseName: 'I am having trouble connecting to my Outline VPN server',
        value: 'connection',
        expectedMsg: 'assist with connecting to a server',
      },
    ];

    for (const {testcaseName, value, expectedMsg} of conditions) {
      it(`'${testcaseName}' shows exit message`, async () => {
        const issue: HTMLElement = issueSelector.querySelector(
          `mwc-list-item[value="${value}"]`
        )!;
        issue.click();
        await nextFrame();

        const exitCard = el.shadowRoot!.querySelector('.exit')!;
        expect(exitCard.textContent).toContain(expectedMsg);
      });
    }

    describe('"General feedback & suggestions"', () => {
      beforeEach(async () => {
        const issue: HTMLElement = issueSelector.querySelector(
          'mwc-list-item[value="general"]'
        )!;
        issue.click();
        await nextFrame();
      });

      it('shows support form', async () => {
        const supportForm = el.shadowRoot!.querySelector('support-form')!;
        expect(supportForm).not.toBeNull();
      });

      it('reports correct values to error reporter on completion of support form', async () => {
        const supportForm: SupportForm =
          el.shadowRoot!.querySelector('support-form')!;
        supportForm.values.email = 'foo@bar.com';
        supportForm.values.subject = 'Test Subject';
        supportForm.values.accessKeySource = 'a friend';
        supportForm.values.description = 'Test Description';
        supportForm.values.outreachConsent = true;
        supportForm.valid = true;
        supportForm.dispatchEvent(new CustomEvent('submit'));
        await nextFrame();

        expect(mockErrorReporter.report).toHaveBeenCalledWith(
          'Test Description',
          'general',
          'foo@bar.com',
          {
            subject: 'Test Subject',
            accessKeySource: 'a friend',
            outreachConsent: true,
            formVersion: 2,
          }
        );
      });

      it('emits success event on completion of support form', async () => {
        const listener = oneEvent(el, 'success');

        const supportForm: SupportForm =
          el.shadowRoot!.querySelector('support-form')!;
        supportForm.valid = true;
        supportForm.dispatchEvent(new CustomEvent('submit'));

        const {detail} = await listener;
        expect(detail).toBeNull();
      });

      it('emits failure event when feedback reporting fails', async () => {
        const listener = oneEvent(el, 'error');
        mockErrorReporter.report.and.throwError('fail');

        const supportForm: SupportForm =
          el.shadowRoot!.querySelector('support-form')!;
        supportForm.valid = true;
        supportForm.dispatchEvent(new CustomEvent('submit'));

        const {detail} = await listener;
        expect(detail).toBeNull();
      });

      it('shows default contact view on cancellation of support form', async () => {
        el.shadowRoot!.querySelector('support-form')!.dispatchEvent(
          new CustomEvent('cancel')
        );

        await nextFrame();

        expect(el.shadowRoot?.querySelector('p.intro')?.textContent).toContain(
          'Tell us how we can help.'
        );
        expect(el.shadowRoot?.querySelector('support-form')).toBeNull();
      });
    });
  });
});
