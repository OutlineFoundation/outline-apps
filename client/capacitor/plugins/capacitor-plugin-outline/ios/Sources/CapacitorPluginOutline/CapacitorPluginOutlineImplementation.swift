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
    }
    
    // MARK: - Plugin API
    
    public func invokeMethod(_ call: CAPPluginCall) {
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
        
        DDLogInfo("stop \(tunnelId))")
        
        Task {
            await OutlineVpn.shared.stop(tunnelId)
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
        let mappedStatus: Int32
        switch status {
        case .connected:
            mappedStatus = 0
        case .disconnected:
            mappedStatus = 1
        case .disconnecting:
            mappedStatus = 3
        case .connecting, .reasserting:
            mappedStatus = 2
        default:
            return
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
}

