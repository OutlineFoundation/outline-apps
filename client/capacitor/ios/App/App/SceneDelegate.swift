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

//
//  SceneUI.swift
//  App
//
//  Created by Mac on 11/06/2026.
//

import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?
    // Track if working directory has been adjusted to prevent multiple adjustments
    private var hasAdjustedWorkingDirectory = false

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let rootViewController = OutlineViewController()
        window.rootViewController = rootViewController
        self.window = window
        window.makeKeyAndVisible()
    }

    // Implement other scene lifecycle methods as needed
    
    func sceneWillEnterForeground(_ scene: UIScene) {
        // Ensure WebView is visible when app returns from background
        // viewWillAppear will also be called, but this ensures it happens immediately
        if let outlineViewController = window?.rootViewController as? OutlineViewController {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                outlineViewController.ensureWebViewVisible()
            }
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        adjustWorkingDirectoryIfNeeded(context: "didBecomeActive")
                
        // Ensure WebView is visible when app becomes active (e.g., after unlocking device)
        // This is separate from viewWillAppear as it handles app state transitions
        if let outlineViewController = window?.rootViewController as? OutlineViewController {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                outlineViewController.ensureWebViewVisible()
            }
        }
    }
    
    private func adjustWorkingDirectoryIfNeeded(context: String) {
        guard !hasAdjustedWorkingDirectory else { return }
        guard let bridgeController = window?.rootViewController as? OutlineViewController else {
            retryWorkingDirectoryAdjustment()
            return
        }
        guard let appPath = bridgeController.bridge?.config.appLocation.path else {
            retryWorkingDirectoryAdjustment()
            return
        }

        if FileManager.default.changeCurrentDirectoryPath(appPath) {
            hasAdjustedWorkingDirectory = true
        }
    }

    /**
     * Retries working directory adjustment if the bridge isn't ready yet.
     * This handles timing issues where the Capacitor bridge might not be initialized immediately.
     */
    private func retryWorkingDirectoryAdjustment() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.adjustWorkingDirectoryIfNeeded(context: "retry")
        }
    }
}
