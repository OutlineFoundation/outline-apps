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

import NetworkExtension

/// The tunnel status reported to the web UI. The values must match
/// `TunnelStatus` in client/web/app/outline_server_repository/vpn.ts.
public enum TunnelStatus: Int {
    case connected = 0
    case disconnected = 1
    case reconnecting = 2
    case disconnecting = 3

    /// Returns nil for the transient and invalid states, which are not reported.
    public init?(_ status: NEVPNStatus) {
        switch status {
        case .connected:
            self = .connected
        case .disconnected:
            self = .disconnected
        case .disconnecting:
            self = .disconnecting
        case .reasserting, .connecting:
            self = .reconnecting
        default:
            return nil
        }
    }
}
