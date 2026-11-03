// Copyright 2025 The Outline Authors
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
import CapacitorPluginOutline
import WebKit

class OutlineViewController: CAPBridgeViewController {
    private var webViewRetryCount = 0
    private let maxWebViewRetries = 10
    // Track if working directory has been adjusted to prevent multiple adjustments
    private var hasAdjustedWorkingDirectory = false
    // Bound the retry loop so a bridge that never initializes can't reschedule forever
    private var workingDirectoryRetryCount = 0
    private let maxWorkingDirectoryRetries = 10
    private var sceneObservers: [NSObjectProtocol] = []

    override func viewDidLoad() {
        super.viewDidLoad()

        #if DEBUG
        // Enable Safari Web Inspector for debugging in development builds
        enableSafariDebugging()
        #endif

        observeSceneLifecycle()
    }

    deinit {
        sceneObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    // MARK: - Scene lifecycle

    // With the SwiftUI entry point (App.swift) there is no scene delegate of
    // our own to receive these, so the root view controller observes the
    // scene notifications for its own window scene instead.
    private func observeSceneLifecycle() {
        let center = NotificationCenter.default
        sceneObservers.append(center.addObserver(
            forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let self = self, self.isOwnScene(notification.object) else { return }
            // Ensure WebView is visible when app returns from background
            // viewWillAppear will also be called, but this ensures it happens immediately
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.ensureWebViewVisible()
            }
        })
        sceneObservers.append(center.addObserver(
            forName: UIScene.didActivateNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let self = self, self.isOwnScene(notification.object) else { return }
            self.adjustWorkingDirectoryIfNeeded()

            // Ensure WebView is visible when app becomes active (e.g., after unlocking device)
            // This is separate from viewWillAppear as it handles app state transitions
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                self.ensureWebViewVisible()
            }
        })
    }

    private func isOwnScene(_ object: Any?) -> Bool {
        guard let scene = object as? UIScene else { return false }
        // Before the view is in a window, there is only one scene to speak of.
        guard let ownScene = view.window?.windowScene else { return true }
        return scene === ownScene
    }

    private func adjustWorkingDirectoryIfNeeded() {
        guard !hasAdjustedWorkingDirectory else { return }
        guard let appPath = bridge?.config.appLocation.path else {
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
            self?.adjustWorkingDirectoryIfNeeded()
        }
    }
    
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Ensure view is visible and has transparent background
        view.isHidden = false
        view.backgroundColor = .clear
        // Ensure WebView is properly configured and loaded
        ensureWebViewVisible()
    }
    
    /**
     * Ensures the WebView is visible, properly configured, and loaded.
     * This function handles:
     * - Making the WebView visible if it was hidden
     * - Setting transparent backgrounds
     * - Reloading the WebView if it hasn't loaded properly (nil URL, empty, or about:blank)
     * - Triggering layout updates to ensure proper rendering
     */
    func ensureWebViewVisible() {
        guard let webView = webView else {
            guard webViewRetryCount < maxWebViewRetries else {
                return
            }
            webViewRetryCount += 1
            // WebView not ready yet, retry after a short delay
            // This handles timing issues where the WebView might not be initialized immediately
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.ensureWebViewVisible()
            }
            return
        }

        webViewRetryCount = 0
        
        // Ensure WebView is visible and has transparent background
        webView.isHidden = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        
        // Check if WebView needs to be reloaded (hasn't loaded or loaded blank page)
        if webViewNeedsReload(webView) {
            // Wait a bit for Capacitor bridge to be fully ready before loading
            // This handles cases where Capacitor hasn't finished initializing the WebView yet
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let self = self, let webView = self.webView, let bridge = self.bridge else { return }

                // Re-check before forcing a load: on cold start Capacitor's initial
                // navigation is still in flight when the first check runs, so the URL is
                // nil then but has become capacitor://localhost/index.html by now. Reloading
                // unconditionally would cancel that navigation and re-run the JS bootstrap,
                // double-initialising the app (duplicate VPN listeners, double load() hooks).
                guard self.webViewNeedsReload(webView) else { return }

                // Load the start URL from Capacitor config
                // This ensures the WebView loads even if Capacitor's automatic loading failed
                let config = bridge.config
                let startUrl = config.serverURL.absoluteString
                if let url = URL(string: startUrl) {
                    let request = URLRequest(url: url)
                    webView.load(request)
                }
            }
        }
        
        // Trigger layout updates to ensure WebView renders correctly
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    /**
     * Returns true when the WebView has no real content loaded (nil, empty, or about:blank URL)
     * and therefore needs to be (re)loaded. Once Capacitor has navigated to its real URL this
     * returns false, which lets the deferred reload skip itself and avoid re-running the JS bootstrap.
     */
    private func webViewNeedsReload(_ webView: WKWebView) -> Bool {
        return webView.url == nil ||
               webView.url?.absoluteString.isEmpty == true ||
               webView.url?.absoluteString == "about:blank"
    }
        
    
    /**
     * Enables Safari Web Inspector for debugging.
     * Only available on iOS 16.4+ and only in DEBUG builds.
     * Allows inspecting the WebView content in Safari's Web Inspector.
     */
    private func enableSafariDebugging() {
        if #available(iOS 16.4, *) {
            // Wait a bit for WebView to be initialized
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self = self else { return }
                
                if let webView = self.webView {
                    webView.isInspectable = true
                } else {
                    // Retry if WebView isn't ready yet
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                        if let webView = self?.webView {
                            webView.isInspectable = true
                        }
                    }
                }
            }
        }
    }
}
