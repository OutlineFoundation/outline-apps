/*
  Copyright 2024 The Outline Authors
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

import {fixture, html, nextFrame} from '@open-wc/testing';

import './index';
import {AddAccessKeyDialog} from './index';
import {localize} from '../../../testing/localize';

const VALID_ACCESS_KEY =
  'ss://YWVzLTI1Ni1nY206c2VjcmV0QHNzLm9yZw@127.0.0.1:443#Test';

async function accessKeyValidator(key: string): Promise<boolean> {
  return key.startsWith('ss://') || key.startsWith('ssconf://');
}

describe('AddAccessKeyDialog', () => {
  let el: AddAccessKeyDialog;
  let validatorSpy: jasmine.Spy;

  beforeEach(async () => {
    validatorSpy = jasmine.createSpy('accessKeyValidator').and.callFake(accessKeyValidator);
    el = await fixture(html`
      <add-access-key-dialog
        .localize=${localize}
        .accessKeyValidator=${validatorSpy}
        .open=${true}
      ></add-access-key-dialog>
    `);
    await nextFrame();
    validatorSpy.calls.reset();
  });

  it('is defined', () => {
    expect(el).toBeInstanceOf(AddAccessKeyDialog);
  });

  describe('attributeChangedCallback guard', () => {
    it('calls runAccessKeyChecks when the access-key attribute changes', async () => {
      el.setAttribute('access-key', VALID_ACCESS_KEY);
      await nextFrame();
      expect(validatorSpy).toHaveBeenCalledWith(VALID_ACCESS_KEY);
    });

    it('does not call the validator when an unrelated attribute changes', async () => {
      el.setAttribute('open', '');
      await nextFrame();
      expect(validatorSpy).not.toHaveBeenCalled();
    });

    it('does not throw a stack overflow when attributes change during validation', async () => {
      expect(() => {
        el.setAttribute('access-key', VALID_ACCESS_KEY);
      }).not.toThrow();
    });
  });
});
