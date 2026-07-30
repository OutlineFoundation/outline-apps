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
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?
    // Track if working directory has been adjusted to prevent multiple adjustments
    private var hasAdjustedWorkingDirectory = false
    // Bound the retry loop so a bridge that never initializes can't reschedule forever
    private var workingDirectoryRetryCount = 0
    private let maxWorkingDirectoryRetries = 10

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let rootViewController = OutlineViewController()
        window.rootViewController = rootViewController
        self.window = window
        window.makeKeyAndVisible()

        // A URL that launched the app (cold start) is delivered here via the
        // connection options rather than through AppDelegate, so forward it too.
        if let urlContext = connectionOptions.urlContexts.first {
            forwardOpen(urlContext.url, options: urlContext.options)
        }
    }

    // MARK: - Deep links

    // In a scene-based app, URLs opened while the app is running are delivered
    // here instead of AppDelegate.application(_:open:options:). Forward them to
    // the Capacitor bridge so ss:// access-key links reach the JavaScript layer.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let urlContext = URLContexts.first else { return }
        forwardOpen(urlContext.url, options: urlContext.options)
    }

    private func forwardOpen(_ url: URL, options: UIScene.OpenURLOptions) {
        var appOptions: [UIApplication.OpenURLOptionsKey: Any] = [:]
        appOptions[.sourceApplication] = options.sourceApplication
        appOptions[.openInPlace] = options.openInPlace
        appOptions[.annotation] = options.annotation
        ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: appOptions)
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
     * Retries are capped by `maxWorkingDirectoryRetries` so a bridge that never finishes
     * initializing (e.g. SPM resolution or a plugin failing during load) can't reschedule forever.
     */
    private func retryWorkingDirectoryAdjustment() {
        guard workingDirectoryRetryCount < maxWorkingDirectoryRetries else { return }
        workingDirectoryRetryCount += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.adjustWorkingDirectoryIfNeeded(context: "retry")
        }
    }
}
