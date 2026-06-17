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

import {StartRequestJson, VpnApi, TunnelStatus} from './vpn';
import * as errors from '../../model/errors';
import {OUTLINE_PLUGIN_NAME, pluginExec} from '../plugin.cordova';

export class CordovaVpnApi implements VpnApi {
  constructor() {}

  start(request: StartRequestJson) {
    if (!request.client) {
      throw new errors.IllegalServerConfiguration();
    }
    return pluginExec<void>(
      'start',
      // TODO(fortuna): Make the Cordova plugin take a StartRequestJson.
      request.id,
      request.name,
      request.client
    );
  }

  stop(id: string) {
    return pluginExec<void>('stop', id);
  }

  isRunning(id: string) {
    return pluginExec<boolean>('isRunning', id);
  }

  onStatusChange(listener: (id: string, status: TunnelStatus) => void): void {
    const onError = (err: unknown) => {
      console.warn('failed to execute status change listener', err);
    };
    const callback = (data: {id: string; status: TunnelStatus}) => {
      listener(data.id, data.status);
    };
    console.debug('CordovaVpnApi: registering onStatusChange callback');
    cordova.exec(callback, onError, OUTLINE_PLUGIN_NAME, 'onStatusChange', []);
  }
}
