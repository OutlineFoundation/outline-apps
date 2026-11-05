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

import Capacitor
import SwiftUI

// Capacitor 9 boots the app from a SwiftUI `App` struct with UIScene. The
// window and the scene belong to SwiftUI; `AppDelegate` only handles the
// application-level callbacks, and `SceneDelegate` the per-scene UIKit APIs
// SwiftUI does not surface.
@main
struct OutlineApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            CapacitorView()
                .ignoresSafeArea()
                // ss:// and ssconf:// access-key links, both on a cold start and
                // while the app is running. SwiftUI owns URL delivery in an
                // App-struct app; the proxy forwards it to the Capacitor bridge
                // (and holds it until the bridge view has appeared).
                .onOpenURL { url in
                    SceneDelegateProxy.shared.handle(openURL: url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    SceneDelegateProxy.shared.handle(userActivity: activity)
                }
        }
    }
}
