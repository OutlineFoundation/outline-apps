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

import * as errors from './errors';
import {deserializeError} from './platform_error';

describe('deserializeError', () => {
  it('converts a Capacitor rejection with a provider error', () => {
    // Capacitor rejects with an Error whose message is the PlatformError JSON.
    const rejection = Object.assign(
      new Error(
        JSON.stringify({
          code: 'ERR_PROVIDER',
          message: 'Quota Exceeded, Contact Support',
          details: {details: 'Plan expired'},
        })
      ),
      {code: 'ERR_PROVIDER'}
    );

    const error = deserializeError(rejection);

    expect(error).toBeInstanceOf(errors.SessionProviderError);
    expect(error.message).toEqual('Quota Exceeded, Contact Support');
    expect((error as errors.SessionProviderError).details).toEqual(
      'Plan expired'
    );
  });

  it('converts a provider error without details', () => {
    const error = deserializeError(
      '{"code":"ERR_PROVIDER","message":"Quota Exceeded, Contact Support"}'
    );

    expect(error).toBeInstanceOf(errors.SessionProviderError);
    expect(error.message).toEqual('Quota Exceeded, Contact Support');
    expect((error as errors.SessionProviderError).details).toBeUndefined();
  });
});
