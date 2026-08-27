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
  private static let kVpnExtensionBundleId = "\(Bundle.main.bundleIdentifier!).VpnExtension"

  public typealias VpnStatusObserver = (NEVPNStatus, String) -> Void

  private var vpnStatusObserver: VpnStatusObserver?
  private let operations = VPNOperationQueue()

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
    try await operations.runStart(tunnelId) { generation in
      try await self.startSession(tunnelId, named: name, withTransport: transportConfig, generation: generation)
    }
  }

  private func startSession(_ tunnelId: String, named name: String?, withTransport transportConfig: String, generation: UInt64) async throws {
    // An unreadable profile is not proof that no VPN is running.
    let existingManager = try await NETunnelProviderManager.loadAllFromPreferences().first
    if let manager = existingManager, isActiveSession(manager.connection) {
      guard manager.connection.status != .connecting else {
        throw OutlineError.internalError(message: "VPN is still connecting; retry when it is ready")
      }
      // Switching must never use stop/start, including when IPC fails or the
      // extension is an older version. Keep the existing VPN in that case.
      try await switchSession(manager, to: tunnelId, named: name ?? "Outline Server", transport: transportConfig, generation: generation)
      return
    }
    if let manager = existingManager, manager.connection.status == .disconnecting {
      throw OutlineError.internalError(message: "VPN is still disconnecting")
    }

    try await operations.checkGeneration(generation)
    let manager: NETunnelProviderManager
    do {
      manager = try await setupVpn(withId: tunnelId, named: name ?? "Outline Server", withTransport: transportConfig)
    } catch {
      DDLogError("Failed to setup VPN: \(error.localizedDescription)")
      throw OutlineError.vpnPermissionNotGranted(cause: error)
    }
    let session = manager.connection as! NETunnelProviderSession

    do {
      try await operations.checkGeneration(generation)
      try await waitForVPNStatus(session, terminalStatuses: [.connected, .disconnected, .invalid],
                                 currentStatuses: [.connected], timeout: 60) {
        try session.startTunnel(options: [:])
      }
    } catch {
      session.stopVPNTunnel()
      DDLogError("Failed to start VPN: \(error.localizedDescription)")
      throw OutlineError.setupSystemVPNFailed(cause: error)
    }

    switch manager.connection.status {
    case .connected:
      break
    case .disconnected, .invalid:
      guard let err = await fetchExtensionLastDisconnectError(session) else {
        throw OutlineError.internalError(message: "unexpected nil disconnect error")
      }
      throw err
    default:
      // This shouldn't happen.
      throw OutlineError.internalError(message: "unexpected connection status")
    }

    // Set an on-demand rule to connect to any available network to implement auto-connect on boot
    do { try await manager.loadFromPreferences() }
    catch {
      DDLogWarn("OutlineVpn.start: Failed to reload preferences: \(error.localizedDescription)")
    }
    let connectRule = NEOnDemandRuleConnect()
    connectRule.interfaceTypeMatch = .any
    manager.onDemandRules = [connectRule]
    do { try await manager.saveToPreferences() }
    catch {
      DDLogWarn("OutlineVpn.start: Failed to save on-demand preference change: \(error.localizedDescription)")
    }
  }

  /** Tears down the VPN if the tunnel with id |tunnelId| is active. */
  public func stop(_ tunnelId: String) async {
    // Capture an in-progress switch before awaiting an identity reply: the
    // runtime may change from A to B while Disconnect(A) is being processed.
    let cancelledStart = await operations.cancelStarts(for: tunnelId)
    let wasActive = await isActive(tunnelId)
    if wasActive { _ = await operations.cancelStarts(for: nil) }
    try? await operations.run {
      guard let manager = await getTunnelManager(), isActiveSession(manager.connection) else {
        return
      }
      let session = manager.connection as! NETunnelProviderSession
      // Runtime identity wins after a handover, even if a preferences write or
      // its acknowledgement was lost. Fall back for older extensions.
      let id = (try? await sendSwitchMessage(session, ["action": "getTunnelId.v1"]).id)
        ?? getTunnelId(forManager: manager)
      guard id == tunnelId || wasActive || cancelledStart else { return }
      _ = await stopSession(manager)
    }
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
    guard isActiveSession(manager.connection) else { return false }
    let session = manager.connection as! NETunnelProviderSession
    let id = (try? await sendSwitchMessage(session, ["action": "getTunnelId.v1"]).id)
      ?? getTunnelId(forManager: manager)
    return id == tunnelId
  }

  // MARK: - Helpers

  public func stopActiveVpn() async {
    _ = await operations.cancelStarts(for: nil)
    try? await operations.run {
      if let manager = await getTunnelManager() {
        _ = await stopSession(manager)
      }
    }
  }

  private func switchSession(_ manager: NETunnelProviderManager, to id: String,
                             named name: String, transport: String, generation: UInt64) async throws {
    let session = manager.connection as! NETunnelProviderSession
    let current = try await sendSwitchMessage(session, ["action": "getTunnelId.v1"])
    guard let oldId = current.id else {
      throw OutlineError.internalError(message: "VPN extension did not report its active server")
    }
    await operations.addCurrentStartId(oldId)
    try await operations.checkGeneration(generation)
    let token = UUID().uuidString
    let oldConfiguration = manager.protocolConfiguration?.copy() as? NETunnelProviderProtocol
    // Recover a committed switch whose final preference write was interrupted.
    if let pending = oldConfiguration?.providerConfiguration?["pendingSwitch"] as? [String: String],
       let pendingToken = pending["token"], pendingToken == current.token, pending["id"] == oldId,
       let pendingTransport = pending["transport"] {
      oldConfiguration?.providerConfiguration = [ConfigKey.tunnelId: oldId, ConfigKey.transport: pendingTransport]
    }
    guard oldConfiguration?.providerConfiguration?[ConfigKey.tunnelId] as? String == oldId else {
      throw OutlineError.internalError(message: "VPN preferences do not match the running server")
    }
    let oldName = manager.localizedDescription
    var preferencesChanged = false
    var commitSent = false
    do {
      let prepared = try await sendSwitchMessage(session, [
        "action": "prepareSwitch.v1", "token": token, "expectedId": oldId,
        "id": id, "transport": transport
      ], timeout: 30)
      try await operations.checkGeneration(generation)
      guard prepared.token == token else {
        throw OutlineError.internalError(message: "VPN extension did not prepare the switch")
      }
      guard let configuration = oldConfiguration?.copy() as? NETunnelProviderProtocol else {
        throw OutlineError.internalError(message: "VPN protocol configuration is missing")
      }
      configuration.providerConfiguration?["pendingSwitch"] = [
        ConfigKey.tunnelId: id, ConfigKey.transport: transport, "token": token
      ]
      manager.protocolConfiguration = configuration
      // Preserve on-demand rules and the existing system tunnel. setupVpn would
      // reset them and is intentionally only used for a fresh connection.
      preferencesChanged = true
      try await manager.saveToPreferences()
      try await operations.checkGeneration(generation)
      commitSent = true
      let committed = try await sendSwitchMessage(session, ["action": "commitSwitch.v1", "token": token])
      guard committed.id == id && committed.token == token else {
        throw OutlineError.internalError(message: "VPN extension did not commit the switch")
      }
    } catch {
      _ = try? await sendSwitchMessage(session, ["action": "abortSwitch.v1", "token": token])
      // A missing reply is not proof of failure: the extension may have switched.
      // Never roll preferences back without reconciling the runtime identity.
      let runtime = try? await sendSwitchMessage(session, ["action": "getTunnelId.v1"])
      if commitSent && runtime?.id == id && runtime?.token == token {
        await finalizeSwitchPreferences(manager, id: id, name: name, transport: transport)
        notifySwitched(from: oldId, to: id, status: session.status)
        return
      }
      if preferencesChanged && runtime?.id == oldId {
        manager.protocolConfiguration = oldConfiguration
        manager.localizedDescription = oldName
        do { try await manager.saveToPreferences() }
        catch { DDLogWarn("Failed to restore VPN preferences after an unsuccessful switch") }
      }
      throw error
    }
    await finalizeSwitchPreferences(manager, id: id, name: name, transport: transport)
    notifySwitched(from: oldId, to: id, status: session.status)
  }

  private func finalizeSwitchPreferences(_ manager: NETunnelProviderManager, id: String,
                                         name: String, transport: String) async {
    let configuration = manager.protocolConfiguration as! NETunnelProviderProtocol
    configuration.providerConfiguration = [ConfigKey.tunnelId: id, ConfigKey.transport: transport]
    manager.localizedDescription = name
    do { try await manager.saveToPreferences() }
    catch {
      // The persisted pendingSwitch + extension commit marker already select the
      // new server on restart. This write only compacts that transaction record.
      DDLogWarn("Failed to compact committed VPN switch preferences")
    }
  }

  private func notifySwitched(from oldId: String, to id: String, status: NEVPNStatus) {
    // These are logical server changes, not system VPN teardown notifications.
    if oldId != id { vpnStatusObserver?(.disconnected, oldId) }
    vpnStatusObserver?(status, id)
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
    DDLogDebug("OutlineVpn.vpnStatusChanged: \(String(describing: notification))")
    guard let session = notification.object as? NETunnelProviderSession else {
      DDLogDebug("Bad session in OutlineVpn.vpnStatusChanged")
      return
    }
    guard let manager = session.manager as? NETunnelProviderManager else {
      // For some reason we get spurious notifications with connecting and disconnecting states
      DDLogDebug("Bad manager in OutlineVpn.vpnStatusChanged session=\(String(describing:session)) status=\(String(describing: session.status))")
      return
    }
    let status = session.status
    Task {
      try? await operations.run {
        // An earlier notification must not re-enable on-demand after Disconnect.
        guard session.status == status else { return }
        var tunnelId = getTunnelId(forManager: manager)
        if status == .connected || status == .reasserting {
          if let runtime = try? await sendSwitchMessage(session, ["action": "getTunnelId.v1"]),
             let runtimeId = runtime.id {
            tunnelId = runtimeId
          }
        }
        guard let tunnelId = tunnelId else { return }
        if isActiveSession(session) {
          await setConnectVpnOnDemand(manager, true)
        }
        self.vpnStatusObserver?(status, tunnelId)
      }
    }
  }
}

// Retrieves the application's tunnel provider manager from the VPN preferences.
private func getTunnelManager() async -> NETunnelProviderManager? {
  do {
    let managers: [NETunnelProviderManager] = try await NETunnelProviderManager.loadAllFromPreferences()
    guard managers.count > 0 else {
      DDLogDebug("OutlineVpn.getTunnelManager: No managers found")
      return nil
    }
    return managers.first
  } catch {
    DDLogError("Failed to get tunnel manager: \(error.localizedDescription)")
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

private func stopSession(_ manager: NETunnelProviderManager) async -> Bool {
  do {
    try await manager.loadFromPreferences()
    await setConnectVpnOnDemand(manager, false)
    try await waitForVPNStatus(manager.connection, terminalStatuses: [.disconnected, .invalid],
                               currentStatuses: [.disconnected, .invalid], timeout: 15) {
      manager.connection.stopVPNTunnel()
    }
    return true
  } catch {
    DDLogWarn("Failed to stop VPN: \(error.localizedDescription)")
    return false
  }
}

// Register synchronously before starting the operation. Notifications, errors and
// the timeout can race, so the continuation and observer must be finished once.
private final class VPNStatusWaiter: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Error>?
  private var observer: NSObjectProtocol?
  private var timeoutWork: DispatchWorkItem?

  init(_ continuation: CheckedContinuation<Void, Error>) {
    self.continuation = continuation
  }

  func observe(_ connection: NEVPNConnection, statuses: [NEVPNStatus], timeout: TimeInterval) {
    lock.lock()
    observer = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange,
                                                       object: connection, queue: nil) { [self] _ in
      if statuses.contains(connection.status) {
        finish(.success(()))
      }
    }
    let work = DispatchWorkItem { [self] in
      finish(.failure(OutlineError.internalError(message: "VPN status change timed out")))
    }
    timeoutWork = work
    lock.unlock()
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: work)
  }

  func finish(_ result: Result<Void, Error>) {
    lock.lock()
    let continuation = self.continuation
    self.continuation = nil
    let observer = self.observer
    self.observer = nil
    let timeoutWork = self.timeoutWork
    self.timeoutWork = nil
    lock.unlock()
    if let observer = observer {
      NotificationCenter.default.removeObserver(observer)
    }
    timeoutWork?.cancel()
    continuation?.resume(with: result)
  }
}

private func waitForVPNStatus(_ connection: NEVPNConnection, terminalStatuses: [NEVPNStatus],
                              currentStatuses: [NEVPNStatus], timeout: TimeInterval,
                              action: () throws -> Void) async throws {
  try await withCheckedThrowingContinuation { continuation in
    let waiter = VPNStatusWaiter(continuation)
    waiter.observe(connection, statuses: terminalStatuses, timeout: timeout)
    do {
      try action()
      if currentStatuses.contains(connection.status) {
        waiter.finish(.success(()))
      }
    } catch {
      waiter.finish(.failure(error))
    }
  }
}

private func setConnectVpnOnDemand(_ manager: NETunnelProviderManager?, _ enabled: Bool) async {
  do {
    try await manager?.loadFromPreferences()
    manager?.isOnDemandEnabled = enabled
    try await manager?.saveToPreferences()
  } catch {
    DDLogError("Failed to set VPN on demand to \(enabled): \(error)")
    return
  }
}


// MARK: - Fetch last disconnect error

// Fetches the most recent error that caused the VPN extension to disconnect.
// Returns nil if the tunnel disconnected cleanly, or an Error describing the failure.
private func fetchExtensionLastDisconnectError(_ session: NETunnelProviderSession) async -> Error? {
  if #available(macOS 13.0, iOS 16.0, *) {
    return await withCheckedContinuation { continuation in
      DDLogDebug("Calling fetchLastDisconnectError")
      session.fetchLastDisconnectError { error in
        DDLogDebug("fetchLastDisconnectError returned: \(String(describing: error))")
        continuation.resume(returning: error)
      }
    }
  }
  // Fallback for macOS 12 / iOS 15: use IPC to read the error the extension saved to disk.
  // Note: sendProviderMessage returns nil when the session is disconnected, so this is best-effort.
  return await fetchExtensionLastDisconnectErrorViaIPC(session)
}

// TODO: Remove once we only support macOS 13.0+, iOS 16.0+
private enum ExtensionIPC {
  static let fetchLastDetailedJsonError = "fetchLastDisconnectDetailedJsonError"
}

/// Keep in sync with the data type defined in PacketTunnelProvider.Swift.
private struct LastErrorIPCData: Decodable {
  let errorCode: String
  let errorJson: String
}

// TODO: Remove once we only support macOS 13.0+, iOS 16.0+
private func fetchExtensionLastDisconnectErrorViaIPC(_ session: NETunnelProviderSession) async -> Error? {
  do {
    guard let rpcNameData = ExtensionIPC.fetchLastDetailedJsonError.data(using: .utf8) else {
      return OutlineError.internalError(message: "IPC fetchLastDisconnectError failed")
    }
    return try await withCheckedThrowingContinuation { continuation in
      do {
        DDLogDebug("Calling Extension IPC: \(ExtensionIPC.fetchLastDetailedJsonError)")
        try session.sendProviderMessage(rpcNameData) { data in
          guard let response = data else {
            DDLogDebug("Extension IPC returned with nil error")
            return continuation.resume(returning: nil)
          }
          do {
            let lastError = try PropertyListDecoder().decode(LastErrorIPCData.self, from: response)
            DDLogDebug("Extension IPC returned with \(lastError)")
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
    DDLogError("Failed to invoke VPN Extension IPC: \(error)")
    return OutlineError.internalError(
      message: "IPC fetchLastDisconnectError failed: \(error.localizedDescription)"
    )
  }
}


// An actor alone is reentrant across awaits. Chaining tasks serializes complete
// user operations and preference updates, including rapid clicks on other servers.
private actor VPNOperationQueue {
  private var tail: Task<Void, Never>?
  private var generation: UInt64 = 0
  private var pendingStarts = [UUID: Set<String>]()
  private var currentStart: UUID?

  func runStart(_ id: String, operation: @escaping (UInt64) async throws -> Void) async throws {
    let request = UUID()
    let generation = self.generation
    pendingStarts[request] = [id]
    defer {
      pendingStarts.removeValue(forKey: request)
      if currentStart == request { currentStart = nil }
    }
    try await run {
      try self.checkGeneration(generation)
      self.currentStart = request
      try await operation(generation)
    }
  }

  func addCurrentStartId(_ id: String) {
    if let currentStart = currentStart { pendingStarts[currentStart]?.insert(id) }
  }

  func cancelStarts(for id: String?) -> Bool {
    let matches = id == nil || pendingStarts.values.contains { $0.contains(id!) }
    if matches { generation &+= 1 }
    return matches && !pendingStarts.isEmpty
  }

  func checkGeneration(_ expected: UInt64) throws {
    guard expected == generation else {
      throw OutlineError.internalError(message: "VPN connection cancelled by Disconnect")
    }
  }

  func run(_ operation: @escaping () async throws -> Void) async throws {
    let previous = tail
    let task = Task {
      await previous?.value
      try await operation()
    }
    tail = Task { _ = try? await task.value }
    try await task.value
  }
}

// Keep aligned with SwiftBridge.switchResponse and the versioned extension IPC.
private struct SwitchResponse: Decodable {
  let id: String?
  let token: String?
  let errorCode: String?
  let errorJson: String?
}

private final class ProviderMessageWaiter: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Data, Error>?

  init(_ continuation: CheckedContinuation<Data, Error>) {
    self.continuation = continuation
  }

  func finish(_ result: Result<Data, Error>) {
    lock.lock()
    let continuation = self.continuation
    self.continuation = nil
    lock.unlock()
    continuation?.resume(with: result)
  }
}

private func sendSwitchMessage(_ session: NETunnelProviderSession, _ request: [String: String],
                                timeout: TimeInterval = 5) async throws -> SwitchResponse {
  let message = try JSONSerialization.data(withJSONObject: request)
  let data: Data = try await withCheckedThrowingContinuation { continuation in
    let waiter = ProviderMessageWaiter(continuation)
    let deadline = DispatchWorkItem {
      waiter.finish(.failure(OutlineError.internalError(message: "VPN extension message timed out")))
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
    do {
      try session.sendProviderMessage(message) { data in
        deadline.cancel()
        if let data = data {
          waiter.finish(.success(data))
        } else {
          waiter.finish(.failure(OutlineError.internalError(message: "VPN extension does not support protected switching")))
        }
      }
    } catch {
      deadline.cancel()
      waiter.finish(.failure(error))
    }
  }
  let response = try JSONDecoder().decode(SwitchResponse.self, from: data)
  if let code = response.errorCode, let json = response.errorJson {
    throw OutlineError.detailedJsonError(code: code, json: json)
  }
  return response
}
