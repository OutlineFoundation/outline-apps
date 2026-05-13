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

import AppIntents
import Foundation
import NetworkExtension
import SwiftUI
import WidgetKit

private struct LastConnectedTunnel: Codable {
  let tunnelId: String
  let serverName: String
  let transportConfig: String
}

// Keep this schema and these keys in sync with OutlineVpnControlStore.swift.
// The control extension stays self-contained so it does not have to link OutlineAppleLib.
private enum OutlineVpnControlStore {
  static let appGroup = "group.org.getoutline.client"

  private static let lastConnectedTunnelKey = "org.outline.lastConnectedTunnel"
  private static let controlExtensionBundleSuffix = ".OutlineControls"

  static func loadLastConnectedTunnel() -> LastConnectedTunnel? {
    guard
      let data = UserDefaults(suiteName: appGroup)?.data(forKey: lastConnectedTunnelKey)
    else {
      return nil
    }
    return try? JSONDecoder().decode(LastConnectedTunnel.self, from: data)
  }

  static func vpnExtensionBundleIdentifier(
    bundleIdentifier: String = Bundle.main.bundleIdentifier ?? ""
  ) -> String {
    var containingAppBundleId = bundleIdentifier
    if containingAppBundleId.hasSuffix(controlExtensionBundleSuffix) {
      containingAppBundleId = String(
        containingAppBundleId.dropLast(controlExtensionBundleSuffix.count)
      )
    }
    return "\(containingAppBundleId).VpnExtension"
  }
}

private enum OutlineVpnControlBridge {
  private enum ConfigKey {
    static let tunnelId = "id"
    static let transport = "transport"
  }

  static func isLastConnectedTunnelActive() async -> Bool {
    guard let lastTunnel = OutlineVpnControlStore.loadLastConnectedTunnel(),
          let manager = await getTunnelManager(),
          tunnelId(for: manager) == lastTunnel.tunnelId
    else {
      return false
    }
    return isActiveSession(manager.connection)
  }

  static func startLastConnectedTunnel() async throws {
    guard let lastTunnel = OutlineVpnControlStore.loadLastConnectedTunnel() else {
      throw OutlineVpnControlError.noLastConnectedTunnel
    }
    if let activeManager = await getTunnelManager(), isActiveSession(activeManager.connection) {
      await stop(activeManager)
    }

    let manager = try await setupVpn(with: lastTunnel)
    guard let session = manager.connection as? NETunnelProviderSession else {
      throw OutlineVpnControlError.invalidTunnelSession
    }
    try session.startTunnel(options: [:])

    do {
      try await manager.loadFromPreferences()
      let connectRule = NEOnDemandRuleConnect()
      connectRule.interfaceTypeMatch = .any
      manager.onDemandRules = [connectRule]
      manager.isOnDemandEnabled = true
      try await manager.saveToPreferences()
    } catch {
      // The VPN is already starting; failing to save on-demand should not flip the control back.
    }
  }

  static func stopActiveTunnel() async {
    guard let manager = await getTunnelManager() else {
      return
    }
    await stop(manager)
  }

  private static func setupVpn(with tunnel: LastConnectedTunnel) async throws -> NETunnelProviderManager {
    let managers = try await NETunnelProviderManager.loadAllFromPreferences()
    let manager = managers.first ?? NETunnelProviderManager()
    manager.localizedDescription = tunnel.serverName
    manager.onDemandRules = nil

    let config = NETunnelProviderProtocol()
    config.serverAddress = "Outline"
    config.providerBundleIdentifier = OutlineVpnControlStore.vpnExtensionBundleIdentifier()
    config.providerConfiguration = [
      ConfigKey.tunnelId: tunnel.tunnelId,
      ConfigKey.transport: tunnel.transportConfig
    ]
    manager.protocolConfiguration = config
    manager.isEnabled = true

    try await manager.saveToPreferences()
    try await manager.loadFromPreferences()
    return manager
  }

  private static func stop(_ manager: NETunnelProviderManager) async {
    do {
      try await manager.loadFromPreferences()
      manager.isOnDemandEnabled = false
      try await manager.saveToPreferences()
    } catch {
      // Stop the session even if preference updates fail.
    }
    await stopTunnel(manager.connection)
  }

  private static func stopTunnel(_ connection: NEVPNConnection) async {
    guard !isStoppedSession(connection) else {
      return
    }

    class TokenHolder {
      var token: NSObjectProtocol?
    }
    let tokenHolder = TokenHolder()

    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      var didResume = false

      func resumeIfStopped() {
        guard isStoppedSession(connection), !didResume else {
          return
        }
        didResume = true
        if let token = tokenHolder.token {
          NotificationCenter.default.removeObserver(
            token,
            name: .NEVPNStatusDidChange,
            object: connection
          )
        }
        continuation.resume()
      }

      tokenHolder.token = NotificationCenter.default.addObserver(
        forName: .NEVPNStatusDidChange,
        object: connection,
        queue: nil
      ) { _ in
        resumeIfStopped()
      }

      connection.stopVPNTunnel()
      resumeIfStopped()
    }
  }

  private static func getTunnelManager() async -> NETunnelProviderManager? {
    do {
      return try await NETunnelProviderManager.loadAllFromPreferences().first
    } catch {
      return nil
    }
  }

  private static func tunnelId(for manager: NETunnelProviderManager?) -> String? {
    let protoConfig = manager?.protocolConfiguration as? NETunnelProviderProtocol
    return protoConfig?.providerConfiguration?[ConfigKey.tunnelId] as? String
  }

  private static func isActiveSession(_ session: NEVPNConnection?) -> Bool {
    let status = session?.status
    return status == .connected || status == .connecting ||
      status == .disconnecting || status == .reasserting
  }

  private static func isStoppedSession(_ session: NEVPNConnection?) -> Bool {
    let status = session?.status
    return status == .disconnected || status == .invalid
  }
}

@available(iOS 18.0, *)
struct OutlineVpnControlValue {
  let isConnected: Bool
  let serverName: String?
}

@available(iOS 18.0, *)
struct OutlineVpnToggleControl: ControlWidget {
  static let kind = "org.outline.ios.client.OutlineVpnToggleControl"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind, provider: Provider()) { value in
      ControlWidgetToggle(
        isOn: value.isConnected,
        action: ToggleOutlineVpnIntent()
      ) {
        Label("Outline VPN", systemImage: "circle.lefthalf.filled")
      } valueLabel: { isOn in
        Text(labelText(isOn: isOn, serverName: value.serverName))
      }
    }
    .displayName("Outline VPN")
    .description("Connect or disconnect the last used Outline server.")
  }

  private func labelText(isOn: Bool, serverName: String?) -> String {
    if isOn {
      return serverName.map { "Connected to \($0)" } ?? "Connected"
    }
    return serverName.map { "Connect to \($0)" } ?? "Open Outline to connect"
  }
}

@available(iOS 18.0, *)
extension OutlineVpnToggleControl {
  struct Provider: ControlValueProvider {
    let previewValue = OutlineVpnControlValue(isConnected: false, serverName: "Outline")

    func currentValue() async throws -> OutlineVpnControlValue {
      let configuration = OutlineVpnControlStore.loadLastConnectedTunnel()
      let isConnected = await OutlineVpnControlBridge.isLastConnectedTunnelActive()
      return OutlineVpnControlValue(
        isConnected: isConnected,
        serverName: configuration?.serverName
      )
    }
  }
}

@available(iOS 18.0, *)
struct ToggleOutlineVpnIntent: SetValueIntent {
  static var title: LocalizedStringResource = "Toggle Outline VPN"

  @Parameter(title: "Connected")
  var value: Bool

  init() {}

  func perform() async throws -> some IntentResult {
    if value {
      try await OutlineVpnControlBridge.startLastConnectedTunnel()
    } else {
      await OutlineVpnControlBridge.stopActiveTunnel()
    }
    return .result()
  }
}

enum OutlineVpnControlError: Error {
  case noLastConnectedTunnel
  case invalidTunnelSession
}

@available(iOS 18.0, *)
@main
struct OutlineControlsBundle: WidgetBundle {
  var body: some Widget {
    OutlineVpnToggleControl()
  }
}
