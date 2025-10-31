import Capacitor
import CocoaLumberjackSwift
import Foundation
import NetworkExtension
import OutlineError
import OutlineNotification
import OutlineSentryLogger
import OutlineTunnel
import Sentry
import Tun2socks
import WebKit
#if os(macOS)
import AppKit
#endif

private enum TunnelStatus: Int {
  case connected = 0
  case disconnected = 1
  case reconnecting = 2
  case disconnecting = 3
}

@objc(OutlinePlugin)
public final class OutlinePlugin: CAPPlugin {
  private enum CallKeys {
    static let method = "method"
    static let input = "input"
    static let tunnelId = "tunnelId"
    static let serverName = "serverName"
    static let transportConfig = "transportConfig"
    static let apiKey = "apiKey"
    static let uuid = "uuid"
  }

  private static let platformName: String = {
    #if os(macOS) || targetEnvironment(macCatalyst)
      return "macOS"
    #else
      return "iOS"
    #endif
  }()

  private static let appGroupIdentifier = "group.org.getoutline.client"
  private static let maxBreadcrumbs: UInt = 100

  private var sentryLogger: OutlineSentryLogger?
  private var observingVpnStatus = false

  // MARK: - Lifecycle

  public override func load() {
    super.load()

    #if DEBUG
      dynamicLogLevel = .all
    #else
      dynamicLogLevel = .info
    #endif

    sentryLogger = OutlineSentryLogger(forAppGroup: OutlinePlugin.appGroupIdentifier)
    configureGoBackendDataDirectory()
    beginObservingVpnStatus()
    installCordovaDebugHooks()

    #if os(macOS) || targetEnvironment(macCatalyst)
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(stopVpnOnAppQuit),
        name: .kAppQuit,
        object: nil
      )
    #endif

    #if os(iOS)
      migrateLocalStorage()
    #endif
  }

  // MARK: - Plugin API

  @objc public func invokeMethod(_ call: CAPPluginCall) {
    guard let methodName = call.getString(CallKeys.method) else {
      return call.reject("Missing method name")
    }
    let input = call.getString(CallKeys.input, "")

    Task {
      do {
        guard let result = OutlineInvokeMethod(methodName, input) else {
          throw OutlineError.internalError(message: "unexpected invoke error")
        }
        if let platformError = result.error {
          throw OutlineError.platformError(platformError)
        }
        await MainActor.run {
          call.resolve(["value": result.value])
        }
      } catch {
        await MainActor.run {
          call.reject(marshalErrorJson(error: error))
        }
      }
    }
  }

  @objc public func start(_ call: CAPPluginCall) {
    guard let tunnelId = call.getString(CallKeys.tunnelId) else {
      return call.reject("Missing tunnel ID")
    }
    guard let serverName = call.getString(CallKeys.serverName) else {
      return call.reject("Missing service name")
    }
    guard let transportConfig = call.getString(CallKeys.transportConfig) else {
      return call.reject("Missing transport configuration")
    }

    DDLogInfo("start \(serverName) (\(tunnelId))")
    Task {
      do {
        try await OutlineVpn.shared.start(tunnelId, named: serverName, withTransport: transportConfig)
        #if os(macOS) || targetEnvironment(macCatalyst)
          NotificationCenter.default.post(name: .kVpnConnected, object: nil)
        #endif
        await MainActor.run { call.resolve() }
      } catch {
        await MainActor.run { call.reject(marshalErrorJson(error: error)) }
      }
    }
  }

  @objc public func stop(_ call: CAPPluginCall) {
    guard let tunnelId = call.getString(CallKeys.tunnelId) else {
      return call.reject("Missing tunnel ID")
    }
    DDLogInfo("stop \(tunnelId)")
    Task {
      await OutlineVpn.shared.stop(tunnelId)
      await MainActor.run { call.resolve() }
    }
  }

  @objc public func isRunning(_ call: CAPPluginCall) {
    guard let tunnelId = call.getString(CallKeys.tunnelId) else {
      return call.reject("Missing tunnel ID")
    }
    Task {
      let active = await OutlineVpn.shared.isActive(tunnelId)
      await MainActor.run { call.resolve(["isRunning": active]) }
    }
  }

  @objc public func initializeErrorReporting(_ call: CAPPluginCall) {
    guard let dsn = call.getString(CallKeys.apiKey) else {
      return call.reject("Missing error reporting API key.")
    }
    DDLogInfo("initializeErrorReporting")

    SentrySDK.start { options in
      options.dsn = dsn
      options.maxBreadcrumbs = OutlinePlugin.maxBreadcrumbs
      options.beforeSend = { event in
        event.context?["app"]?.removeValue(forKey: "device_app_hash")
        if var device = event.context?["device"] {
          device.removeValue(forKey: "timezone")
          device.removeValue(forKey: "memory_size")
          device.removeValue(forKey: "free_memory")
          device.removeValue(forKey: "usable_memory")
          device.removeValue(forKey: "storage_size")
          event.context?["device"] = device
        }
        return event
      }
    }

    call.resolve()
  }

  @objc public func reportEvents(_ call: CAPPluginCall) {
    let uuid = call.getString(CallKeys.uuid) ?? UUID().uuidString

    sentryLogger?.addVpnExtensionLogsToSentry(maxBreadcrumbsToAdd: Int(OutlinePlugin.maxBreadcrumbs / 2))
    SentrySDK.capture(message: "\(OutlinePlugin.platformName) report (\(uuid))") { scope in
      scope.setLevel(.info)
      scope.setTag(value: uuid, key: "user_event_id")
    }
    call.resolve()
  }

  @objc public func quitApplication(_ call: CAPPluginCall) {
    #if os(macOS)
      NSApplication.shared.terminate(self)
    #endif
    call.resolve()
  }

  // MARK: - Helpers

  private func beginObservingVpnStatus() {
    guard !observingVpnStatus else { return }
    OutlineVpn.shared.onVpnStatusChange { [weak self] status, tunnelId in
      self?.emitVpnStatus(status, tunnelId: tunnelId)
    }
    observingVpnStatus = true
  }

  private func emitVpnStatus(_ status: NEVPNStatus, tunnelId: String) {
    let mappedStatus: Int32
    switch status {
    case .connected:
      #if os(macOS) || targetEnvironment(macCatalyst)
        NotificationCenter.default.post(name: .kVpnConnected, object: nil)
      #endif
      mappedStatus = Int32(TunnelStatus.connected.rawValue)
    case .disconnected:
      #if os(macOS) || targetEnvironment(macCatalyst)
        NotificationCenter.default.post(name: .kVpnDisconnected, object: nil)
      #endif
      mappedStatus = Int32(TunnelStatus.disconnected.rawValue)
    case .disconnecting:
      mappedStatus = Int32(TunnelStatus.disconnecting.rawValue)
    case .connecting, .reasserting:
      mappedStatus = Int32(TunnelStatus.reconnecting.rawValue)
    default:
      return
    }

    notifyListeners(
      "vpnStatus",
      data: [
        "id": tunnelId,
        "status": mappedStatus,
      ],
      retainUntilConsumed: true
    )
  }

  #if os(macOS) || targetEnvironment(macCatalyst)
  @objc private func stopVpnOnAppQuit() {
    Task {
      await OutlineVpn.shared.stopActiveVpn()
    }
  }
  #endif

  private func configureGoBackendDataDirectory() {
    guard let goConfig = OutlineGetBackendConfig() else { return }
    do {
      let dataPath = try FileManager.default.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      ).path
      goConfig.dataDir = dataPath
    } catch {
      DDLogWarn("Error finding Application Support directory: \(error)")
    }
  }

  #if os(iOS)
  private func migrateLocalStorage() {
    let uiFilename = "file__0.localstorage"
    let wkFilename = "app_localhost_0.localstorage"

    let fileManager = FileManager.default
    let appLibraryDir = fileManager.urls(for: .libraryDirectory, in: .userDomainMask)[0]

    let uiStorageDir: URL
    #if targetEnvironment(macCatalyst)
      guard let bundleID = Bundle.main.bundleIdentifier else {
        DDLogError("Unable to get bundleID for app.")
        return
      }
      let appSupportDir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      uiStorageDir = appSupportDir.appendingPathComponent(bundleID)
    #else
      if fileManager.fileExists(atPath: appLibraryDir.appendingPathComponent("WebKit/LocalStorage/\(uiFilename)").relativePath) {
        uiStorageDir = appLibraryDir.appendingPathComponent("WebKit/LocalStorage")
      } else {
        uiStorageDir = appLibraryDir.appendingPathComponent("Caches")
      }
    #endif

    let uiStorage = uiStorageDir.appendingPathComponent(uiFilename)
    if !fileManager.fileExists(atPath: uiStorage.relativePath) {
      DDLogInfo("Not migrating, UIWebView local storage files missing.")
      return
    }

    let wkStorageDir = appLibraryDir.appendingPathComponent("WebKit/WebsiteData/LocalStorage/")
    let wkStorage = wkStorageDir.appendingPathComponent(wkFilename)

    if fileManager.fileExists(atPath: wkStorage.relativePath) {
      DDLogInfo("Not migrating, WKWebView local storage files present.")
      return
    }
    DDLogInfo("Migrating UIWebView local storage to WKWebView")

    do {
      try fileManager.createDirectory(at: wkStorageDir, withIntermediateDirectories: true)
    } catch {
      DDLogError("Failed to create WKWebView local storage directory")
      return
    }

    guard let tmpDir = try? fileManager.url(
      for: .itemReplacementDirectory,
      in: .userDomainMask,
      appropriateFor: wkStorage,
      create: true
    ) else {
      DDLogError("Failed to create tmp dir")
      return
    }

    do {
      try fileManager.copyItem(at: uiStorage, to: tmpDir.appendingPathComponent(wkStorage.lastPathComponent))
      try fileManager.copyItem(at: URL(fileURLWithPath: "\(uiStorage.relativePath)-shm"), to: tmpDir.appendingPathComponent("\(wkFilename)-shm"))
      try fileManager.copyItem(at: URL(fileURLWithPath: "\(uiStorage.relativePath)-wal"), to: tmpDir.appendingPathComponent("\(wkFilename)-wal"))
    } catch {
      DDLogError("Local storage migration failed.")
      return
    }

    guard (try? fileManager.replaceItemAt(wkStorageDir, withItemAt: tmpDir, backupItemName: nil, options: .usingNewMetadataOnly)) != nil else {
      DDLogError("Failed to copy tmp dir to WKWebView local storage dir")
      return
    }

    DDLogInfo("Local storage migration succeeded")
  }
  #endif

  // MARK: - Debug helpers

  private func installCordovaDebugHooks() {
    guard let webView = bridge?.webView as? WKWebView else {
      DDLogWarn("OutlinePlugin: Unable to install Cordova debug hooks; webView unavailable or not WKWebView.")
      return
    }

    let hookScript = """
      (function() {
        if (window.__outlineCordovaDebugHookInstalled) { return; }
        window.__outlineCordovaDebugHookInstalled = true;
        document.addEventListener('deviceready', function() {
          window.__outlineCordovaDevicereadyFired = true;
        }, { once: true });
      })();
    """
    webView.evaluateJavaScript(hookScript, completionHandler: nil)

    func logCordovaState(label: String) {
      webView.evaluateJavaScript("typeof window.cordova") { result, error in
        if let error {
          DDLogWarn("OutlinePlugin: [\(label)] Failed to evaluate typeof window.cordova: \(error)")
        } else {
          DDLogInfo("OutlinePlugin: [\(label)] typeof window.cordova = \(String(describing: result))")
        }
      }
      webView.evaluateJavaScript("Boolean(window.__outlineCordovaDevicereadyFired)") { result, error in
        if let error {
          DDLogWarn("OutlinePlugin: [\(label)] Failed to evaluate deviceready flag: \(error)")
        } else {
          DDLogInfo("OutlinePlugin: [\(label)] deviceready fired = \(String(describing: result))")
        }
      }
      webView.evaluateJavaScript("document.readyState") { result, error in
        if let error {
          DDLogWarn("OutlinePlugin: [\(label)] Failed to evaluate document.readyState: \(error)")
        } else {
          DDLogInfo("OutlinePlugin: [\(label)] document.readyState = \(String(describing: result))")
        }
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      logCordovaState(label: "t+1s")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
      logCordovaState(label: "t+3s")
    }
  }

  deinit {
    #if os(macOS) || targetEnvironment(macCatalyst)
      NotificationCenter.default.removeObserver(self, name: .kAppQuit, object: nil)
    #endif
  }
}
