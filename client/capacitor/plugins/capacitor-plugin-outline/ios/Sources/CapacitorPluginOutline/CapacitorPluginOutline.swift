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

import Capacitor
import CocoaLumberjack
import CocoaLumberjackSwift
import Foundation
import NetworkExtension
import OutlineError
import OutlineSentryLogger
import OutlineTunnel
import Tun2socks

// Adapts OutlineAppleLib to Capacitor: translates plugin calls into calls on
// the library and forwards the VPN status to the web UI.
@objc(CapacitorPluginOutline)
public class CapacitorPluginOutline: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapacitorPluginOutline"
    public let jsName = "CapacitorPluginOutline"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "invokeMethod", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initializeErrorReporting", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "quitApplication", returnType: CAPPluginReturnPromise)
    ]

    private enum CallKeys {
        static let method = "method"
        static let input = "input"
        static let tunnelId = "tunnelId"
        static let serverName = "serverName"
        static let transportConfig = "transportConfig"
        static let apiKey = "apiKey"
        static let uuid = "uuid"
    }

    private static let appGroupIdentifier = "group.org.getoutline.client"

    private var sentryLogger: OutlineSentryLogger?

    public override func load() {
        #if DEBUG
        dynamicLogLevel = .all
        #else
        dynamicLogLevel = .info
        #endif

        sentryLogger = OutlineSentryLogger(forAppGroup: Self.appGroupIdentifier)
        configureGoBackendDataDirectory()
        beginObservingVpnStatus()

        #if os(iOS)
        migrateUIWebViewLocalStorage()
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
                let errorJson = marshalErrorJson(error: error)
                await MainActor.run {
                    call.reject(errorJson)
                }
            }
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        guard let tunnelId = call.getString(CallKeys.tunnelId) else {
            return call.reject("Missing tunnel ID")
        }
        guard let serverName = call.getString(CallKeys.serverName) else {
            return call.reject("Missing server name")
        }
        guard let transportConfig = call.getString(CallKeys.transportConfig) else {
            return call.reject("Missing transport configuration")
        }

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

    @objc public func stop(_ call: CAPPluginCall) {
        guard let tunnelId = call.getString(CallKeys.tunnelId) else {
            return call.reject("Missing tunnel ID")
        }

        Task {
            await OutlineVpn.shared.stop(tunnelId)
            await MainActor.run {
                call.resolve()
            }
        }
    }

    @objc public func isRunning(_ call: CAPPluginCall) {
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

    @objc public func initializeErrorReporting(_ call: CAPPluginCall) {
        guard let dsn = call.getString(CallKeys.apiKey) else {
            return call.reject("Missing error reporting API key")
        }

        SentryErrorReporter.start(dsn: dsn)

        call.resolve()
    }

    @objc public func reportEvents(_ call: CAPPluginCall) {
        let uuid = call.getString(CallKeys.uuid) ?? UUID().uuidString
        SentryErrorReporter.send(uuid: uuid, vpnExtensionLogsFrom: sentryLogger)
        call.resolve()
    }

    @objc public func quitApplication(_ call: CAPPluginCall) {
        call.resolve()
    }

    // MARK: - Helpers

    private func beginObservingVpnStatus() {
        OutlineVpn.shared.onVpnStatusChange { [weak self] status, tunnelId in
            self?.emitVpnStatus(status, tunnelId: tunnelId)
        }
    }

    private func emitVpnStatus(_ status: NEVPNStatus, tunnelId: String) {
        guard let tunnelStatus = TunnelStatus(status) else {
            return  // Do not report transient or invalid states.
        }
        notifyListeners(
            "onStatusChange",
            data: [
                "id": tunnelId,
                "status": Int32(tunnelStatus.rawValue)
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
            DDLogError("Failed to configure Go backend data directory: \(error)")
        }
    }
}
