// Copyright 2024 The Outline Authors
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

/// <reference types='cordova'/>

import { deserializeError } from '../model/platform_error';

export const OUTLINE_PLUGIN_NAME = 'OutlinePlugin';

type VpnStatusPayload = { id: string; status: number };

function throwDeserialized(error: unknown): never {
  throw deserializeError(error);
}

// Helper function to call the Outline Cordova plugin.
export async function pluginExec<T>(
  cmd: string,
  ...args: unknown[]
): Promise<T> {
  if (typeof cordova === 'undefined' || typeof cordova.exec !== 'function') {
    throwDeserialized(new Error('Cordova is not available on this platform'));
  }

  return new Promise<T>((resolve, reject) => {
    const wrappedReject = (e: unknown) => reject(deserializeError(e));
    cordova.exec(resolve, wrappedReject, OUTLINE_PLUGIN_NAME, cmd, args);
  });
}

export function registerVpnStatusListener(
  listener: (payload: VpnStatusPayload) => void,
  onError?: (err: unknown) => void
): void {
  if (typeof cordova === 'undefined' || typeof cordova.exec !== 'function') {
    const error = new Error('Cordova is not available on this platform');
    if (onError) {
      onError(deserializeError(error));
    } else {
      console.warn(error.message);
    }
    return;
  }

  cordova.exec(
    listener,
    onError ? (err: unknown) => onError(deserializeError(err)) : console.warn,
    OUTLINE_PLUGIN_NAME,
    'onStatusChange',
    []
  );
}
