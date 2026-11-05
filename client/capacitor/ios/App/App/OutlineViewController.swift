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
    // Capacitor's own router decides whether a request is for a file or for the
    // app's index.html by building a file URL from the request path and looking
    // at its extension. For the main-frame request the path is empty, so that
    // URL is the process's current directory, and whether index.html gets
    // served depends on where the process was started from, which the app does
    // not control: started inside a directory whose name has an extension (an
    // .app bundle, say), the web view stays blank. This router applies the
    // same rule to the path string itself.
    private struct Router: Capacitor.Router {
        var basePath: String = ""

        func route(for path: String) -> String {
            if (path as NSString).pathExtension.isEmpty {
                return basePath + "/index.html"
            }
            return basePath + path
        }
    }

    override func router() -> Capacitor.Router {
        return Router()
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        #if DEBUG
        // Enable Safari Web Inspector for debugging in development builds
        enableSafariDebugging()
        #endif
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
