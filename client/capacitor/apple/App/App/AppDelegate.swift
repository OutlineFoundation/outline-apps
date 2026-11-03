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

import UIKit
import Capacitor
import OutlineTunnel
#if targetEnvironment(macCatalyst)
import OutlineCatalystApp
#endif

// Installed by App.swift through @UIApplicationDelegateAdaptor. Not the entry
// point: the SwiftUI `OutlineApp` struct is. URL and user-activity handling
// live on the SwiftUI scene (App.swift), not here.
class AppDelegate: NSObject, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        #if targetEnvironment(macCatalyst)
        // Loads the AppKitIntegration framework (menu bar status item, Dock
        // icon policy) and keeps its connection status in sync with the VPN.
        OutlineCatalystApp.initApp()
        // The window's title bar and fixed size are UIWindowScene properties
        // SwiftUI has no modifier for. No scene exists yet at this point, and
        // SceneDelegate stays empty (see there), so configure each scene as
        // UIKit announces it.
        NotificationCenter.default.addObserver(
            forName: UIScene.willConnectNotification, object: nil, queue: .main
        ) { notification in
            guard let windowScene = notification.object as? UIWindowScene else { return }
            windowScene.titlebar?.titleVisibility = .hidden
            windowScene.titlebar?.toolbar = nil
            windowScene.sizeRestrictions?.minimumSize = CGSize(width: 400, height: 680)
            windowScene.sizeRestrictions?.maximumSize = CGSize(width: 400, height: 680)
        }
        #endif
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        ApplicationDelegateProxy.shared.application(application, supportedInterfaceOrientationsFor: window)
    }
}
