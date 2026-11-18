// Copyright 2023 The Outline Authors
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

#if targetEnvironment(macCatalyst)

    import CocoaLumberjack
    import CocoaLumberjackSwift
    import Foundation
    import OutlineNotification
    import UIKit

    /// What the app does on macOS only, where it runs as a Mac Catalyst app:
    /// the menu bar item and Dock icon policy, which need AppKit and so live in
    /// the AppKitIntegration framework, and the look of the window.
    public enum CatalystAppIntegration {
        /// Call once, when the app has finished launching.
        public static func start() {
            DDLog.add(DDOSLogger.sharedInstance)

            let appKitController = loadAppKitIntegrationFramework()

            // The window's title bar and fixed size are UIWindowScene properties
            // SwiftUI has no modifier for. No scene exists yet when the app has
            // just launched, so configure each scene as UIKit announces it.
            NotificationCenter.default.addObserver(
                forName: UIScene.willConnectNotification, object: nil, queue: .main
            ) { notification in
                guard let windowScene = notification.object as? UIWindowScene else { return }
                windowScene.titlebar?.titleVisibility = .hidden
                windowScene.titlebar?.toolbar = nil
                windowScene.sizeRestrictions?.minimumSize = CGSize(width: 400, height: 680)
                windowScene.sizeRestrictions?.maximumSize = CGSize(width: 400, height: 680)
            }

            // Initiate the connection status menu in unknown state by default.
            // TODO: Check status in case the the VPN is already running.
            appKitController._AppKitBridge_setConnectionStatus(.unknown)

            NotificationCenter.default.addObserver(forName: NSNotification.kVpnConnected,
                                                   object: nil,
                                                   queue: nil)
            { _ in
                appKitController._AppKitBridge_setConnectionStatus(.connected)
            }
            NotificationCenter.default.addObserver(forName: NSNotification.kVpnDisconnected,
                                                   object: nil,
                                                   queue: nil)
            { _ in
                appKitController._AppKitBridge_setConnectionStatus(.disconnected)
            }
        }
    }

    /// Loads the AppKitIntegration framework embedded in the app and returns
    /// its controller. AppKit classes cannot be referenced from Catalyst code,
    /// so the controller is driven through the selectors declared in
    /// NSObject+Outline.swift.
    private func loadAppKitIntegrationFramework() -> NSObject {
        if let frameworksPath = Bundle.main.privateFrameworksPath {
            let bundlePath = "\(frameworksPath)/AppKitIntegration.framework"
            do {
                try Bundle(path: bundlePath)?.loadAndReturnError()

                let bundle = Bundle(path: bundlePath)!
                DDLogInfo("[CatalystAppIntegration] AppKit bundle loaded successfully")

                if let appKitControllerClass = bundle.classNamed("AppKitIntegration.AppKitController") as? NSObject.Type {
                    return appKitControllerClass.init()
                }
            } catch {
                DDLogInfo("[CatalystAppIntegration] Error loading: \(error)")
            }
        }
        preconditionFailure("[CatalystAppIntegration] Unable to load")
    }

#endif
