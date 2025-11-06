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
import UIKit
import WebKit
import CapacitorPluginOutline

class OutlineViewController: CAPBridgeViewController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        registerOutlinePlugin()
        
        #if DEBUG
        enableSafariDebugging()
        #endif
    }
    
    private func registerOutlinePlugin() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, let bridge = self.bridge as? CapacitorBridge else {
                NSLog("[OutlineViewController] Bridge not ready for plugin registration")
                return
            }
            
            let plugin = CapacitorPluginOutline()
            plugin.bridge = bridge
            plugin.load()
            
            bridge.registerPluginInstance(plugin)
            NSLog("[OutlineViewController] CapacitorPluginOutline registered")
        }
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

