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

import Capacitor
import CocoaLumberjack
import CocoaLumberjackSwift
import Foundation
import NetworkExtension
import OutlineError
import OutlineNotification
import OutlineSentryLogger
import OutlineTunnel
import Sentry
import Tun2socks

#if os(macOS)
import AppKit
#endif

@objc public class CapacitorPluginOutlineImplementation: NSObject {
    
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
    private weak var plugin: CAPPlugin?
    
    public init(plugin: CAPPlugin) {
        self.plugin = plugin
        super.init()
        
        #if DEBUG
        dynamicLogLevel = .all
        #else
        dynamicLogLevel = .info
        #endif
        
        sentryLogger = OutlineSentryLogger(forAppGroup: CapacitorPluginOutlineImplementation.appGroupIdentifier)
        configureGoBackendDataDirectory()
        beginObservingVpnStatus()
        
        #if os(macOS)
        // Handle URL interception for ss:// URLs
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.handleOpenUrl),
            name: .kHandleUrl,
            object: nil
        )
        #endif
        
        #if os(macOS) || targetEnvironment(macCatalyst)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.stopVpnOnAppQuit),
            name: .kAppQuit,
            object: nil
        )
        #endif
        
        #if os(iOS)
        migrateLocalStorage()
        #endif
    }
    
    // MARK: - Plugin API
    
    public func invokeMethod(_ call: CAPPluginCall) {
        guard let methodName = call.getString(CallKeys.method) else {
            return call.reject("Missing method name")
        }
        let input = call.getString(CallKeys.input, "")
        
        DDLogDebug("Invoking Method \(methodName) with input \(input)")
        
        Task {
            do {
                guard let result = OutlineInvokeMethod(methodName, input) else {
                    DDLogError("InvokeMethod \(methodName) got nil result")
                    throw OutlineError.internalError(message: "unexpected invoke error")
                }
                if let platformError = result.error {
                    let errorJson = marshalErrorJson(error: OutlineError.platformError(platformError))
                    DDLogDebug("InvokeMethod \(methodName) failed with error \(errorJson)")
                    throw OutlineError.platformError(platformError)
                }
                DDLogDebug("InvokeMethod result: \(result.value)")
                await MainActor.run {
                    call.resolve(["value": result.value])
                }
            } catch {
                let errorJson = marshalErrorJson(error: error)
                DDLogError("InvokeMethod \(methodName) threw exception: \(errorJson)")
                await MainActor.run {
                    call.reject(errorJson)
                }
            }
        }
    }
    
    public func start(_ call: CAPPluginCall) {
        guard let tunnelId = call.getString(CallKeys.tunnelId) else {
            return call.reject("Missing tunnel ID")
        }
        guard let serverName = call.getString(CallKeys.serverName) else {
            return call.reject("Missing server name")
        }
        guard let transportConfig = call.getString(CallKeys.transportConfig) else {
            return call.reject("Missing transport configuration")
        }
        
        DDLogInfo("start \(serverName) (\(tunnelId))")
        
        Task {
            do {
                try await OutlineVpn.shared.start(tunnelId, named: serverName, withTransport: transportConfig)
                #if os(macOS) || targetEnvironment(macCatalyst)
                NotificationCenter.default.post(
                    name: .kVpnConnected,
                    object: nil
                )
                #endif
                await MainActor.run {
                    call.resolve()
                }
            } catch {
                await MainActor.run {
                    call.reject(marshalErrorJson(error: error))
                }
            }
        }
    }
    
    public func stop(_ call: CAPPluginCall) {
        guard let tunnelId = call.getString(CallKeys.tunnelId) else {
            return call.reject("Missing tunnel ID")
        }
        
        DDLogInfo("stop \(tunnelId)")
        
        Task {
            await OutlineVpn.shared.stop(tunnelId)
            #if os(macOS) || targetEnvironment(macCatalyst)
            NotificationCenter.default.post(
                name: .kVpnDisconnected,
                object: nil
            )
            #endif
            await MainActor.run {
                call.resolve()
            }
        }
    }
    
    public func isRunning(_ call: CAPPluginCall) {
        guard let tunnelId = call.getString(CallKeys.tunnelId) else {
            return call.reject("Missing tunnel ID")
        }
        
        Task {
            let active = await OutlineVpn.shared.isActive(tunnelId)
            await MainActor.run {
                call.resolve(["isRunning": active])
            }
        }
    }
    
    public func initializeErrorReporting(_ call: CAPPluginCall) {
        guard let dsn = call.getString(CallKeys.apiKey) else {
            return call.reject("Missing error reporting API key")
        }
        
        DDLogInfo("initializeErrorReporting")
        
        SentrySDK.start { options in
            options.dsn = dsn
            options.maxBreadcrumbs = CapacitorPluginOutlineImplementation.maxBreadcrumbs
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
    
    public func reportEvents(_ call: CAPPluginCall) {
        let uuid = call.getString(CallKeys.uuid) ?? UUID().uuidString
        sentryLogger?.addVpnExtensionLogsToSentry(maxBreadcrumbsToAdd: Int(CapacitorPluginOutlineImplementation.maxBreadcrumbs / 2))
        SentrySDK.capture(message: "\(CapacitorPluginOutlineImplementation.platformName) report (\(uuid))") { scope in
            scope.setLevel(.info)
            scope.setTag(value: uuid, key: "user_event_id")
        }
        call.resolve()
    }
    
    public func quitApplication(_ call: CAPPluginCall) {
        #if os(macOS)
        NSApplication.shared.terminate(self)
        #endif
        call.resolve()
    }
    
    // MARK: - Helpers
    
    private func beginObservingVpnStatus() {
        OutlineVpn.shared.onVpnStatusChange { [weak self] status, tunnelId in
            self?.emitVpnStatus(status, tunnelId: tunnelId)
        }
    }
    
    private func emitVpnStatus(_ status: NEVPNStatus, tunnelId: String) {
        DDLogDebug(
            "CapacitorPluginOutline received onStatusChange (\(String(describing: status))) for tunnel \(tunnelId)"
        )
        
        let mappedStatus: Int32
        switch status {
        case .connected:
            #if os(macOS) || targetEnvironment(macCatalyst)
            NotificationCenter.default.post(
                name: .kVpnConnected,
                object: nil
            )
            #endif
            mappedStatus = TunnelStatus.connected.rawValue
        case .disconnected:
            #if os(macOS) || targetEnvironment(macCatalyst)
            NotificationCenter.default.post(
                name: .kVpnDisconnected,
                object: nil
            )
            #endif
            mappedStatus = TunnelStatus.disconnected.rawValue
        case .disconnecting:
            mappedStatus = TunnelStatus.disconnecting.rawValue
        case .reasserting:
            mappedStatus = TunnelStatus.reconnecting.rawValue
        case .connecting:
            mappedStatus = TunnelStatus.reconnecting.rawValue
        default:
            return  // Do not report transient or invalid states.
        }
        
        plugin?.notifyListeners(
            "vpnStatus",
            data: [
                "id": tunnelId,
                "status": mappedStatus
            ],
            retainUntilConsumed: true
        )
    }
    
    private func configureGoBackendDataDirectory() {
        guard let goConfig = OutlineGetBackendConfig() else {
            return
        }
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
    
    // MARK: - URL Interception (macOS only)
    
    #if os(macOS)
    @objc private func handleOpenUrl(_ notification: Notification) {
        guard let url = notification.object as? String else {
            return NSLog("Received non-String object.")
        }
        NSLog("Intercepted URL.")
        guard let urlJson = try? JSONEncoder().encode(url),
              let encodedUrl = String(data: urlJson, encoding: .utf8)
        else {
            return NSLog("Failed to JS-encode intercepted URL")
        }
        // In Capacitor, URL handling is typically done through AppDelegate
        // This notification can be used to trigger JavaScript handlers
        DispatchQueue.main.async {
            // Capacitor handles URL interception differently than Cordova
            // The URL should be handled by the Capacitor AppDelegate
            NSLog("URL intercepted: \(url)")
        }
    }
    #endif
    
    // MARK: - App Quit Handler
    
    #if os(macOS) || targetEnvironment(macCatalyst)
    @objc private func stopVpnOnAppQuit() {
        Task {
            await OutlineVpn.shared.stopActiveVpn()
        }
    }
    #endif
    
    // MARK: - Local Storage Migration (iOS only)
    
    #if os(iOS)
    private func migrateLocalStorage() {
        // Local storage backing files have the following naming format: $scheme_$hostname_$port.localstorage
        // With UIWebView, the app used the file:// scheme with no hostname and any port.
        let kUIWebViewLocalStorageFilename = "file__0.localstorage"
        // With WKWebView, the app uses the app:// scheme with localhost as a hostname and any port.
        let kWKWebViewLocalStorageFilename = "app_localhost_0.localstorage"
        
        let fileManager = FileManager.default
        let appLibraryDir = fileManager.urls(
            for: .libraryDirectory,
            in: .userDomainMask
        )[0]
        
        let uiWebViewLocalStorageDir: URL
        #if targetEnvironment(macCatalyst)
        guard let bundleID = Bundle.main.bundleIdentifier else {
            return DDLogError("Unable to get bundleID for app.")
        }
        let appSupportDir = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        uiWebViewLocalStorageDir = appSupportDir.appendingPathComponent(bundleID)
        #else
        if fileManager.fileExists(
            atPath: appLibraryDir.appendingPathComponent(
                "WebKit/LocalStorage/\(kUIWebViewLocalStorageFilename)"
            ).relativePath
        ) {
            uiWebViewLocalStorageDir = appLibraryDir.appendingPathComponent("WebKit/LocalStorage")
        } else {
            uiWebViewLocalStorageDir = appLibraryDir.appendingPathComponent("Caches")
        }
        #endif
        let uiWebViewLocalStorage = uiWebViewLocalStorageDir.appendingPathComponent(kUIWebViewLocalStorageFilename)
        if !fileManager.fileExists(atPath: uiWebViewLocalStorage.relativePath) {
            return DDLogInfo("Not migrating, UIWebView local storage files missing.")
        }
        
        let wkWebViewLocalStorageDir = appLibraryDir.appendingPathComponent("WebKit/WebsiteData/LocalStorage/")
        let wkWebViewLocalStorage = wkWebViewLocalStorageDir.appendingPathComponent(kWKWebViewLocalStorageFilename)
        // Only copy the local storage files if they don't exist for WKWebView.
        if fileManager.fileExists(atPath: wkWebViewLocalStorage.relativePath) {
            return DDLogInfo("Not migrating, WKWebView local storage files present.")
        }
        DDLogInfo("Migrating UIWebView local storage to WKWebView")
        
        // Create the WKWebView local storage directory; this is safe if the directory already exists.
        do {
            try fileManager.createDirectory(
                at: wkWebViewLocalStorageDir,
                withIntermediateDirectories: true
            )
        } catch {
            return DDLogError("Failed to create WKWebView local storage directory")
        }
        
        // Create a tmp directory and copy onto it the local storage files.
        guard let tmpDir = try? fileManager.url(
            for: .itemReplacementDirectory,
            in: .userDomainMask,
            appropriateFor: wkWebViewLocalStorage,
            create: true
        ) else {
            return DDLogError("Failed to create tmp dir")
        }
        do {
            try fileManager.copyItem(
                at: uiWebViewLocalStorage,
                to: tmpDir.appendingPathComponent(wkWebViewLocalStorage.lastPathComponent)
            )
            try fileManager.copyItem(
                at: URL(fileURLWithPath: "\(uiWebViewLocalStorage.relativePath)-shm"),
                to: tmpDir.appendingPathComponent("\(kWKWebViewLocalStorageFilename)-shm")
            )
            try fileManager.copyItem(
                at: URL(fileURLWithPath: "\(uiWebViewLocalStorage.relativePath)-wal"),
                to: tmpDir.appendingPathComponent("\(kWKWebViewLocalStorageFilename)-wal")
            )
        } catch {
            return DDLogError("Local storage migration failed.")
        }
        
        // Atomically move the tmp directory to the WKWebView local storage directory.
        guard (try? fileManager.replaceItemAt(
            wkWebViewLocalStorageDir,
            withItemAt: tmpDir,
            backupItemName: nil,
            options: .usingNewMetadataOnly
        )) != nil else {
            return DDLogError("Failed to copy tmp dir to WKWebView local storage dir")
        }
        
        DDLogInfo("Local storage migration succeeded")
    }
    #endif
}

