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

class OutlineViewController: CAPBridgeViewController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        #if DEBUG
        // Enable Safari Web Inspector for debugging in development builds
        enableSafariDebugging()
        #endif
    }
    
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Register the custom Outline plugin after Capacitor has finished loading
        registerOutlinePlugin()
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
            // WebView not ready yet, retry after a short delay
            // This handles timing issues where the WebView might not be initialized immediately
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.ensureWebViewVisible()
            }
            return
        }
        
        // Ensure WebView is visible and has transparent background
        webView.isHidden = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        
        // Check if WebView needs to be reloaded (hasn't loaded or loaded blank page)
        let needsReload = webView.url == nil || 
                         webView.url?.absoluteString.isEmpty == true ||
                         webView.url?.absoluteString == "about:blank"
        
        if needsReload {
            // Wait a bit for Capacitor bridge to be fully ready before loading
            // This handles cases where Capacitor hasn't finished initializing the WebView yet
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let self = self, let webView = self.webView, let bridge = self.bridge else { return }
                
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
     * Registers the custom Outline plugin with the Capacitor bridge.
     * This plugin provides VPN functionality and other native features.
     */
    private func registerOutlinePlugin() {
        guard let bridge = self.bridge as? CapacitorBridge else {
            return
        }
        
        let plugin = CapacitorPluginOutline()
        bridge.registerPluginInstance(plugin)
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
