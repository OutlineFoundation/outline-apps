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

// Deliberately empty. SwiftUI owns the window (see App.swift), and a scene
// delegate that implements scene(_:openURLContexts:) or scene(_:continue:)
// would take URL delivery away from App.swift's .onOpenURL. The class exists
// so per-scene UIKit APIs that SwiftUI does not surface have somewhere to go;
// AppDelegate names it in configurationForConnecting. The Catalyst window
// setup lives in AppDelegate (a UIScene.willConnectNotification observer).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {}
