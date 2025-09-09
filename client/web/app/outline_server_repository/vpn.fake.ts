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
// Note that because this implementation does not emit disconnection events, "switching" between
// servers in the server list will not work as expected.
export class FakeVpnApi implements VpnApi {
  private running = false;

  constructor() {}

  private playBroken(address?: string) {
    return address?.startsWith(FAKE_BROKEN_HOSTNAME);
  }

  private playUnreachable(address?: string) {
    return address?.startsWith(FAKE_UNREACHABLE_HOSTNAME);
  }

  async start(request: StartRequestJson): Promise<void> {
    if (this.running) {
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

    this.running = true;
  }

  async stop(_id: string): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
  }

  async isRunning(_id: string): Promise<boolean> {
    return this.running;
  }

  onStatusChange(_listener: (id: string, status: TunnelStatus) => void): void {
    // NOOP
  }
}
