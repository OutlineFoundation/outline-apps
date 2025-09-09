// Copyright 2021 The Outline Authors
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

import {TunnelStatus} from '../web/app/outline_server_repository/vpn';

// Represents a VPN tunnel to a proxy server.
export interface VpnTunnel {
  // Starts a system-wide VPN that tunnels IP traffic.
  // checkProxyConnectivity indicates whether to check TCP and UDP connectivity to the proxy server.
  connect(checkProxyConnectivity: boolean): Promise<void>;

  // Stops tunneling and tears down the VPN.
  disconnect(): Promise<void>;

  // Callback to notify the tunnel about a network connectivity change.
  networkChanged(status: TunnelStatus): void;

  // TODO(alalama): expose on/once methods and use EventEmmitter.

  // Resolved once the tunnel is disconnected after `disconnect` is called,
  // or when the tunnel disconnects spontaneously.
  readonly onceDisconnected: Promise<void>;

  // Sets an optional callback for when the tunnel is attempting to re-connect.
  onReconnecting(listener?: () => void): void;

  // Sets an optional callback for when the tunnel successfully reconnects.
  onReconnected(listener?: () => void): void;

  // Turns on verbose logging. Must be called before connecting the tunnel.
  enableDebugMode(): void;
}
