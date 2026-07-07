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

import {VpnApi, TunnelStatus, StartRequestJson} from './vpn';
import * as errors from '../../model/errors';

export const FAKE_BROKEN_HOSTNAME = '192.0.2.1';
export const FAKE_UNREACHABLE_HOSTNAME = '10.0.0.24';

// Fake VPN API implementation for demoing and testing.
// Emits status change events on start/stop, like the real implementations do,
// so server switching and status-driven UI can be exercised in the browser.
export class FakeVpnApi implements VpnApi {
  private runningId: string | null = null;
  private listeners: Array<(id: string, status: TunnelStatus) => void> = [];

  constructor() {}

  private playBroken(address?: string) {
    return address?.startsWith(FAKE_BROKEN_HOSTNAME);
  }

  private playUnreachable(address?: string) {
    return address?.startsWith(FAKE_UNREACHABLE_HOSTNAME);
  }

  private notifyListeners(id: string, status: TunnelStatus) {
    for (const listener of this.listeners) {
      listener(id, status);
    }
  }

  async start(request: StartRequestJson): Promise<void> {
    if (this.runningId === request.id) {
      return;
    }

    const address = request.firstHop;
    if (this.playUnreachable(address)) {
      throw new errors.OutlinePluginError(errors.ErrorCode.SERVER_UNREACHABLE);
    } else if (this.playBroken(address)) {
      throw new errors.OutlinePluginError(
        errors.ErrorCode.CLIENT_START_FAILURE
      );
    }

    // Like the real implementations, starting a new tunnel disconnects the
    // currently running one.
    if (this.runningId !== null) {
      this.notifyListeners(this.runningId, TunnelStatus.DISCONNECTED);
    }

    this.runningId = request.id;
    this.notifyListeners(request.id, TunnelStatus.CONNECTED);
  }

  async stop(id: string): Promise<void> {
    if (this.runningId !== id) {
      return;
    }
    this.runningId = null;
    this.notifyListeners(id, TunnelStatus.DISCONNECTED);
  }

  async isRunning(id: string): Promise<boolean> {
    return this.runningId === id;
  }

  onStatusChange(listener: (id: string, status: TunnelStatus) => void): void {
    this.listeners.push(listener);
  }
}
