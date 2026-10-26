/*
  Copyright 2025 The Outline Authors
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

import {fixture, html} from '@open-wc/testing';

import './index';
import {ErrorDetailsDialog} from './index';
import {localize} from '../../../testing/localize';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWindow = any;

describe('ErrorDetailsDialog', () => {
  let el: ErrorDetailsDialog;
  let writeTextSpy: jasmine.Spy;
  let originalCordova: unknown;

  beforeEach(async () => {
    originalCordova = (window as AnyWindow).cordova;
    writeTextSpy = spyOn(navigator.clipboard, 'writeText');
    spyOn(console, 'error');
    el = await fixture(html`
      <error-details-dialog
        .localize=${localize}
        .errorDetails=${'some error details'}
        .open=${true}
      ></error-details-dialog>
    `);
  });

  afterEach(() => {
    (window as AnyWindow).cordova = originalCordova;
  });

  it('marks as copied when the web clipboard succeeds', async () => {
    writeTextSpy.and.returnValue(Promise.resolve());

    await el.copyErrorDetails();

    expect(writeTextSpy).toHaveBeenCalledWith('some error details');
    expect(el.copied).toBeTrue();
  });

  it('falls back to the Cordova clipboard when write permission is denied', async () => {
    writeTextSpy.and.returnValue(
      Promise.reject(
        new DOMException('Write permission denied.', 'NotAllowedError')
      )
    );
    const copySpy = jasmine
      .createSpy('copy')
      .and.callFake((_text: string, onSuccess: () => void) => onSuccess());
    (window as AnyWindow).cordova = {plugins: {clipboard: {copy: copySpy}}};

    await el.copyErrorDetails();

    expect(copySpy).toHaveBeenCalledWith(
      'some error details',
      jasmine.any(Function),
      jasmine.any(Function)
    );
    expect(el.copied).toBeTrue();
  });

  it('does not mark as copied and rethrows when all copy methods fail', async () => {
    const webError = new DOMException(
      'Write permission denied.',
      'NotAllowedError'
    );
    writeTextSpy.and.returnValue(Promise.reject(webError));
    (window as AnyWindow).cordova = undefined;

    await expectAsync(el.copyErrorDetails()).toBeRejectedWith(webError);
    expect(el.copied).toBeFalse();
    expect(console.error).toHaveBeenCalled();
  });

  it('does not mark as copied when the Cordova fallback also fails', async () => {
    writeTextSpy.and.returnValue(
      Promise.reject(
        new DOMException('Write permission denied.', 'NotAllowedError')
      )
    );
    const cordovaError = new Error('plugin failure');
    (window as AnyWindow).cordova = {
      plugins: {
        clipboard: {
          copy: (
            _text: string,
            _onSuccess: () => void,
            onFailure: (e: unknown) => void
          ) => onFailure(cordovaError),
        },
      },
    };

    await expectAsync(el.copyErrorDetails()).toBeRejectedWith(cordovaError);
    expect(el.copied).toBeFalse();
  });
});
