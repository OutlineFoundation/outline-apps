// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Foundation

public struct OutlineVpnControlConfiguration: Codable, Equatable {
  public let tunnelId: String
  public let serverName: String
  public let transportConfig: String

  public init(tunnelId: String, serverName: String, transportConfig: String) {
    self.tunnelId = tunnelId
    self.serverName = serverName
    self.transportConfig = transportConfig
  }
}

public enum OutlineVpnControlStore {
  public static let appGroup = "group.org.getoutline.client"

  // Keep these keys in sync with the self-contained store in OutlineControls.swift.
  private static let lastConnectedTunnelKey = "org.outline.lastConnectedTunnel"
  private static let controlExtensionBundleSuffix = ".OutlineControls"

  public static func saveLastConnectedTunnel(_ configuration: OutlineVpnControlConfiguration) {
    guard let data = try? JSONEncoder().encode(configuration) else {
      return
    }
    userDefaults?.set(data, forKey: lastConnectedTunnelKey)
  }

  public static func loadLastConnectedTunnel() -> OutlineVpnControlConfiguration? {
    guard let data = userDefaults?.data(forKey: lastConnectedTunnelKey) else {
      return nil
    }
    return try? JSONDecoder().decode(OutlineVpnControlConfiguration.self, from: data)
  }

  public static func clearLastConnectedTunnel(matching tunnelId: String) {
    guard loadLastConnectedTunnel()?.tunnelId == tunnelId else {
      return
    }
    userDefaults?.removeObject(forKey: lastConnectedTunnelKey)
  }

  public static func containingAppBundleIdentifier(
    bundleIdentifier: String = Bundle.main.bundleIdentifier ?? ""
  ) -> String {
    if bundleIdentifier.hasSuffix(controlExtensionBundleSuffix) {
      return String(bundleIdentifier.dropLast(controlExtensionBundleSuffix.count))
    }
    return bundleIdentifier
  }

  public static func vpnExtensionBundleIdentifier(
    bundleIdentifier: String = Bundle.main.bundleIdentifier ?? ""
  ) -> String {
    "\(containingAppBundleIdentifier(bundleIdentifier: bundleIdentifier)).VpnExtension"
  }

  private static var userDefaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }
}
