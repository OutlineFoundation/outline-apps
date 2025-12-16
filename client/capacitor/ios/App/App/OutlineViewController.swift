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
        enableSafariDebugging()
        #endif
    }
    
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        registerOutlinePlugin()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        view.isHidden = false
        view.backgroundColor = .clear
        ensureWebViewVisible()
    }
    
    func ensureWebViewVisible() {
        guard let webView = webView else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.ensureWebViewVisible()
            }
            return
        }
        
        webView.isHidden = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        
        let needsReload = webView.url == nil || 
                         webView.url?.absoluteString.isEmpty == true ||
                         webView.url?.absoluteString == "about:blank"
        
        if needsReload {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let self = self, let webView = self.webView else { return }
                
                if let currentUrl = webView.url, 
                   !currentUrl.absoluteString.isEmpty && 
                   currentUrl.absoluteString != "about:blank" {
                    webView.reload()
                } else {
                    if let bridge = self.bridge {
                        let config = bridge.config
                        let startUrl = config.serverURL.absoluteString
                        if let url = URL(string: startUrl) {
                            let request = URLRequest(url: url)
                            webView.load(request)
                        }
                    }
                }
            }
        }
        
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }
        
    private func registerOutlinePlugin() {
        guard let bridge = self.bridge as? CapacitorBridge else {
            return
        }
        
        let plugin = CapacitorPluginOutline()
        bridge.registerPluginInstance(plugin)
    }
    
    private func enableSafariDebugging() {
        if #available(iOS 16.4, *) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self = self else { return }
                
                if let webView = self.webView {
                    webView.isInspectable = true
                } else {
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
