// Copyright 2018 The Outline Authors
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

import {IpcRendererEvent} from 'electron/main';

import {TunnelStatus} from './vpn';
import {StartRequestJson} from './vpn';
import {VpnApi} from './vpn';
import * as methodChannel from '../method_channel';

export class ElectronVpnApi implements VpnApi {
  private statusChangeListener:
    | ((id: string, status: TunnelStatus) => void)
    | null = null;

  private runningServerId: string | undefined;

  constructor() {
    // This event is received when the proxy connects. It is mainly used for signaling the UI that
    // the proxy has been automatically connected at startup (if the user was connected at shutdown)
    window.electron.methodChannel.on(
      'proxy-status',
      (event: IpcRendererEvent, serverId: string, status: TunnelStatus) => {
        if (status === TunnelStatus.CONNECTED) {
          this.runningServerId = serverId;
        }
        if (status === TunnelStatus.DISCONNECTED) {
          this.runningServerId = undefined;
        }
        if (this.statusChangeListener) {
          this.statusChangeListener(serverId, status);
        } else {
          console.error(
            `${serverId} status changed to ${status} but no listener set`
          );
        }
      }
    );
  }

  async start(request: StartRequestJson) {
    if (this.runningServerId === request.id) {
      return Promise.resolve();
    }

    await methodChannel
      .getDefaultMethodChannel()
      .invokeMethod('StartProxying', JSON.stringify(request));
  }

  async stop(id: string) {
    if (this.runningServerId !== id) {
      return;
    }

    await methodChannel
      .getDefaultMethodChannel()
      .invokeMethod('StopProxying', '');
  }

  async isRunning(id: string): Promise<boolean> {
    return this.runningServerId === id;
  }

  onStatusChange(listener: (id: string, status: TunnelStatus) => void): void {
    this.statusChangeListener = listener;
  }
}
