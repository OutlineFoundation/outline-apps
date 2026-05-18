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

export const enum TunnelStatus {
  CONNECTED,
  DISCONNECTED,
  RECONNECTING,
  DISCONNECTING,
}

/** StartRequestJson is the serializable request to start the VPN, used for persistence and IPCs. */
export interface StartRequestJson {
  id: string;
  name: string;
  // Client config, ultimately passed to NewClient in Go.
  client: string;
  // First hop used by the legacy Electron code.
  firstHop: string;
}

/** VpnApi is how we talk to the platform-specific VPN API. */
export interface VpnApi {
  /**
   * Connects a VPN, routing all device traffic as described in the SessionConfig.
   * If there is another running instance, broadcasts a disconnect event and stops the active
   * tunnel. In such case, restarts tunneling while preserving the VPN.
   * @throws {OutlinePluginError}
   */
  start(request: StartRequestJson): Promise<void>;

  /** Stops the tunnel and VPN service. */
  stop(id: string): Promise<void>;

  /** Returns whether the tunnel instance is active. */
  isRunning(id: string): Promise<boolean>;

  /** Sets a listener, to be called when the tunnel status changes. */
  onStatusChange(listener: (id: string, status: TunnelStatus) => void): void;
}
