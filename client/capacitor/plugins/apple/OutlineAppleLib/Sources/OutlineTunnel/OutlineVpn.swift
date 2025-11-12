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

import CocoaLumberjackSwift
import NetworkExtension
import OutlineError

// Manages the system's VPN tunnel through the VpnExtension process.
@objcMembers
public class OutlineVpn: NSObject {
  public static let shared = OutlineVpn()
  // Bundle ID must match the provisioning profile: com.nthlink.outline.PacketTunnel
  private static let kVpnExtensionBundleId = "\(Bundle.main.bundleIdentifier!).PacketTunnel"

  public typealias VpnStatusObserver = (NEVPNStatus, String) -> Void

  private var vpnStatusObserver: VpnStatusObserver?

  private enum Action {
    static let start = "start"
    static let restart = "restart"
    static let stop = "stop"
    static let getTunnelId = "getTunnelId"
  }

  private enum ConfigKey {
    static let tunnelId = "id"
    static let transport = "transport"
  }

  override private init() {
    super.init()
    // Register observer for VPN changes.
    // Remove self to guard against receiving duplicate notifications due to page reloads.
    NotificationCenter.default.removeObserver(self, name: .NEVPNStatusDidChange, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(self.vpnStatusChanged),
                                           name: .NEVPNStatusDidChange, object: nil)
  }

  // MARK: - Interface

  /** Starts a VPN tunnel as specified in the OutlineTunnel object. */
  public func start(_ tunnelId: String, named name: String?, withTransport transportConfig: String) async throws {
    if let manager = await getTunnelManager(), isActiveSession(manager.connection) {
      await stopSession(manager)
    }

    let manager: NETunnelProviderManager
    do {
      manager = try await setupVpn(withId: tunnelId, named: name ?? "Outline Server", withTransport: transportConfig)
    } catch {
      throw OutlineError.vpnPermissionNotGranted(cause: error)
    }
    let session = manager.connection as! NETunnelProviderSession

    // Register observer for start process completion.
    class TokenHolder {
      var token: NSObjectProtocol?
    }
    let tokenHolder = TokenHolder()
      let startDone = Task {
          await withCheckedContinuation { continuation in
              tokenHolder.token = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: manager.connection, queue: nil) { notification in
                  // The notification object is always the session, so we can rely on that to not be nil.
                  guard let connection = notification.object as? NETunnelProviderSession else {
                      return
                  }
                  
                  let status = connection.status
                  // The observer may be triggered multiple times, but we only remove it when we reach an end state.
                  // A successful connection will go through .connecting -> .disconnected
                  // A failed connection will go through .connecting -> .disconnecting -> .disconnected
                  // An .invalid event may happen if the configuration is modified and ends in an invalid state.
                  if status == .connected || status == .disconnected || status == .invalid {
                      if let token = tokenHolder.token {
                          NotificationCenter.default.removeObserver(token, name: .NEVPNStatusDidChange, object: connection)
                      }
                      continuation.resume()
                  }
              }
          }
      }

    // Start the session.
    do {
      try session.startTunnel(options: [:])
    } catch {
      throw OutlineError.setupSystemVPNFailed(cause: error)
    }

    // Wait for it to be done.
    await startDone.value

    let finalStatus = manager.connection.status
    switch finalStatus {
    case .connected:
      break
    case .disconnected, .invalid:
      guard let err = await fetchExtensionLastDisconnectError(session) else {
        throw OutlineError.internalError(
          message: "VPN extension failed to start and did not provide error details. " +
          "The extension may have crashed during initialization. " +
          "Expected bundle ID: \(OutlineVpn.kVpnExtensionBundleId). " +
          "Check Xcode console or device logs for extension crash details."
        )
      }
      throw err
    default:
      // This shouldn't happen.
      throw OutlineError.internalError(message: "unexpected connection status: \(String(describing: finalStatus))")
    }

    // Set an on-demand rule to connect to any available network to implement auto-connect on boot
    do { try await manager.loadFromPreferences() }
    catch {
    }
    let connectRule = NEOnDemandRuleConnect()
    connectRule.interfaceTypeMatch = .any
    manager.onDemandRules = [connectRule]
    do { try await manager.saveToPreferences() }
    catch {
    }
  }

  /** Tears down the VPN if the tunnel with id |tunnelId| is active. */
  public func stop(_ tunnelId: String) async {
    guard let manager = await getTunnelManager(),
          getTunnelId(forManager: manager) == tunnelId,
          isActiveSession(manager.connection) else {
      return
    }
    await stopSession(manager)
  }

  /** Calls |observer| when the VPN's status changes. */
  public func onVpnStatusChange(_ observer: @escaping(VpnStatusObserver)) {
    vpnStatusObserver = observer
  }

  
  /** Returns whether |tunnelId| is actively proxying through the VPN. */
  public func isActive(_ tunnelId: String?) async -> Bool {
    guard tunnelId != nil, let manager = await getTunnelManager() else {
      return false
    }
    return getTunnelId(forManager: manager) == tunnelId && isActiveSession(manager.connection)
  }

  // MARK: - Helpers

  public func stopActiveVpn() async {
    if let manager = await getTunnelManager() {
      await stopSession(manager)
    }
  }

  // Adds a VPN configuration to the user preferences if no Outline profile is present. Otherwise
  // enables the existing configuration.
  private func setupVpn(withId id:String, named name:String, withTransport transportConfig: String) async throws -> NETunnelProviderManager {
    let managers = try await NETunnelProviderManager.loadAllFromPreferences()
    var manager: NETunnelProviderManager!
    if managers.count > 0 {
      manager = managers.first
    } else {
      manager = NETunnelProviderManager()
    }

    manager.localizedDescription = name
    // Make sure on-demand is disable, so it doesn't retry on start failure.
    manager.onDemandRules = nil

    // Configure the protocol.
    let config = NETunnelProviderProtocol()
    // TODO(fortuna): set to something meaningful if we can.
    config.serverAddress = "Outline"
    config.providerBundleIdentifier = OutlineVpn.kVpnExtensionBundleId
    config.providerConfiguration = [
      ConfigKey.tunnelId: id,
      ConfigKey.transport: transportConfig
    ]
    manager.protocolConfiguration = config

    // A VPN configuration must be enabled before it can be used to bring up a VPN tunnel.
    manager.isEnabled = true

    try await manager.saveToPreferences()
    // Workaround for https://forums.developer.apple.com/thread/25928
    try await manager.loadFromPreferences()
    return manager
  }

  // Receives NEVPNStatusDidChange notifications. Calls onTunnelStatusChange for the active
  // tunnel.
  func vpnStatusChanged(notification: NSNotification) {
    guard let session = notification.object as? NETunnelProviderSession else {
      return
    }
    guard let manager = session.manager as? NETunnelProviderManager else {
      return
    }
    guard let protoConfig = manager.protocolConfiguration as? NETunnelProviderProtocol,
          let tunnelId = protoConfig.providerConfiguration?["id"] as? String else {
      return
    }
    if isActiveSession(session) {
      Task {
        await setConnectVpnOnDemand(manager, true)
      }
    }
    self.vpnStatusObserver?(session.status, tunnelId)
  }
}

// Retrieves the application's tunnel provider manager from the VPN preferences.
private func getTunnelManager() async -> NETunnelProviderManager? {
  do {
    let managers: [NETunnelProviderManager] = try await NETunnelProviderManager.loadAllFromPreferences()
    guard managers.count > 0 else {
      return nil
    }
    return managers.first
  } catch {
    return nil
  }
}

private func getTunnelId(forManager manager:NETunnelProviderManager?) -> String? {
  let protoConfig = manager?.protocolConfiguration as? NETunnelProviderProtocol
  return protoConfig?.providerConfiguration?["id"] as? String
}

private func isActiveSession(_ session: NEVPNConnection?) -> Bool {
  let vpnStatus = session?.status
  return vpnStatus == .connected || vpnStatus == .connecting || vpnStatus == .reasserting
}

private func stopSession(_ manager:NETunnelProviderManager) async {
  do {
    try await manager.loadFromPreferences()
    await setConnectVpnOnDemand(manager, false) // Disable on demand so the VPN does not connect automatically.
    manager.connection.stopVPNTunnel()
    // Wait for stop to be completed.
    class TokenHolder {
      var token: NSObjectProtocol?
    }
    let tokenHolder = TokenHolder()
    await withCheckedContinuation { continuation in
      tokenHolder.token = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: manager.connection, queue: nil) { notification in
        if manager.connection.status == .disconnected {
          if let token = tokenHolder.token {
            NotificationCenter.default.removeObserver(token, name: .NEVPNStatusDidChange, object: manager.connection)
          }
          continuation.resume()
        }
      }
    }
  } catch {
  }
}

private func setConnectVpnOnDemand(_ manager: NETunnelProviderManager?, _ enabled: Bool) async {
  do {
    try await manager?.loadFromPreferences()
    manager?.isOnDemandEnabled = enabled
    try await manager?.saveToPreferences()
  } catch {
    return
  }
}


// MARK: - Fetch last disconnect error

// TODO: Remove this code once we only support newer systems (macOS 13.0+, iOS 16.0+)
// mimics fetchLastDisconnectErrorWithCompletionHandler on older systems
// See: "fetch last disconnect error" section in the VPN extension code.

private enum ExtensionIPC {
  static let fetchLastDetailedJsonError = "fetchLastDisconnectDetailedJsonError"
}

/// Keep it in sync with the data type defined in PacketTunnelProvider.Swift
/// Also keep in mind that we will always use PropertyListEncoder and PropertyListDecoder to marshal this data.
private struct LastErrorIPCData: Decodable {
  let errorCode: String
  let errorJson: String
}

// Fetches the most recent error that caused the VPN extension to disconnect.
// If no error, it returns nil. Otherwise, it returns a description of the error.
private func fetchExtensionLastDisconnectError(_ session: NETunnelProviderSession) async -> Error? {
  do {
    guard let rpcNameData = ExtensionIPC.fetchLastDetailedJsonError.data(using: .utf8) else {
      return OutlineError.internalError(message: "IPC fetchLastDisconnectError failed")
    }
    return try await withCheckedThrowingContinuation { continuation in
      do {
        try session.sendProviderMessage(rpcNameData) { data in
          guard let response = data else {
            return continuation.resume(returning: nil)
          }
          do {
            let lastError = try PropertyListDecoder().decode(LastErrorIPCData.self, from: response)
            continuation.resume(returning: OutlineError.detailedJsonError(code: lastError.errorCode,
                                                                          json: lastError.errorJson))
          } catch {
            continuation.resume(throwing: error)
          }
        }
      } catch {
        continuation.resume(throwing: error)
      }
    }
  } catch {
    return OutlineError.internalError(
      message: "IPC fetchLastDisconnectError failed: \(error.localizedDescription)"
    )
  }
}
