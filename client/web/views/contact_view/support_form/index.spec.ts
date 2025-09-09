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

import {TextField} from '@material/mwc-textfield';

import {
  fixture,
  html,
  nextFrame,
  oneEvent,
  triggerBlurFor,
  triggerFocusFor,
} from '@open-wc/testing';

import {FormValues, SupportForm} from './index';

async function setValue(el: TextField, value: string) {
  await triggerFocusFor(el);
  el.value = value;
  await triggerBlurFor(el);
  el.dispatchEvent(new CustomEvent('blur'));
}

describe('SupportForm', () => {
  it('is defined', async () => {
    const el = await fixture(html` <support-form></support-form> `);
    expect(el).toBeInstanceOf(SupportForm);
  });

  it('sets fields with provided form values', async () => {
    const values: FormValues = {
      email: 'foo@bar.com',
      accessKeySource: 'a friend',
      subject: 'Test Subject',
      description: 'Test Description',
      outreachConsent: false,
    };
    const el = await fixture(html`
      <support-form .values=${values}></support-form>
    `);

    const emailInput: TextField = el.shadowRoot!.querySelector(
      'mwc-textfield[name="email"'
    )!;
    expect(emailInput.value).toBe('foo@bar.com');
    const accessKeySourceInput: TextField = el.shadowRoot!.querySelector(
      'mwc-textfield[name="accessKeySource"'
    )!;
    expect(accessKeySourceInput.value).toBe('a friend');
    const subjectInput: TextField = el.shadowRoot!.querySelector(
      'mwc-textfield[name="subject"'
    )!;
    expect(subjectInput.value).toBe('Test Subject');
    const descriptionInput: TextField = el.shadowRoot!.querySelector(
      'mwc-textarea[name="description"'
    )!;
    expect(descriptionInput.value).toBe('Test Description');
  });

  it('updating the `values` property updates the form', async () => {
    const el: SupportForm = await fixture(html`
      <support-form></support-form>
    `);
    const emailInput: TextField = el.shadowRoot!.querySelector(
      'mwc-textfield[name="email"'
    )!;
    await setValue(emailInput, 'foo@bar.com');

    el.values = {};
    await nextFrame();

    expect(emailInput.value).toBe('');
  });

  it('submit button is disabled by default', async () => {
    const el = await fixture(html` <support-form></support-form> `);
    const submitButton = el.shadowRoot!.querySelectorAll(
      'mwc-button'
    )[1] as HTMLElement;
    expect(submitButton.hasAttribute('disabled')).toBeTrue();
  });

  describe('when form is valid', () => {
    let el: SupportForm;
    let submitButton: HTMLElement;

    beforeEach(async () => {
      el = await fixture(html` <support-form></support-form> `);

      const emailInput: TextField = el.shadowRoot!.querySelector(
        'mwc-textfield[name="email"'
      )!;
      await setValue(emailInput, 'foo@bar.com');
      const accessKeySourceInput: TextField = el.shadowRoot!.querySelector(
        'mwc-textfield[name="accessKeySource"'
      )!;
      await setValue(accessKeySourceInput, 'From a friend');
      const subjectInput: TextField = el.shadowRoot!.querySelector(
        'mwc-textfield[name="subject"'
      )!;
      await setValue(subjectInput, 'Test Subject');
      const descriptionInput: TextField = el.shadowRoot!.querySelector(
        'mwc-textarea[name="description"'
      )!;
      await setValue(descriptionInput, 'Test Description');

      submitButton = el.shadowRoot!.querySelectorAll(
        'mwc-button'
      )[1] as HTMLElement;
    });

    it('submit button is enabled', async () => {
      expect(submitButton.hasAttribute('disabled')).toBeFalse();
    });

    it('clicking submit button emits form submit success event', async () => {
      const listener = oneEvent(el, 'submit');

      submitButton.click();

      const {detail} = await listener;
      expect(detail).toBeTrue();
    });
  });

  it('emits form cancel event', async () => {
    const el: SupportForm = await fixture(html`
      <support-form></support-form>
    `);
    const listener = oneEvent(el, 'cancel');

    const cancelButton = el.shadowRoot!.querySelectorAll(
      'mwc-button'
    )[0] as HTMLElement;
    cancelButton.click();

    const {detail} = await listener;
    expect(detail).toBeTrue();
  });
});
