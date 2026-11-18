// Copyright 2023 The Outline Authors
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

import AppKit
import ServiceManagement

class AppKitController: NSObject {
    private var statusItemController: StatusItemController?
    private var windowCloseObserver: NSObjectProtocol?

    override public required init() {
        super.init()

        // Indicates that the application is an ordinary app that appears in the Dock and may have a user interface.
        NSApp.setActivationPolicy(.regular)
        
        // Set up window close observer to hide Dock icon when main window is closed
        setupWindowCloseObserver()
    }
    
    deinit {
        if let observer = windowCloseObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        NotificationCenter.default.removeObserver(
            self, name: NSApplication.didBecomeActiveNotification, object: nil)
    }
    
    private func setupWindowCloseObserver() {
        windowCloseObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let window = notification.object as? NSWindow else { return }
            
            if window.isAppWindow {
                self?.hideDockIcon()
            }
        }
        
        // Restore the Dock icon when the app becomes active again (e.g. the main
        // window is reopened after being closed).
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    @objc private func appDidBecomeActive() {
        // Show Dock icon when app becomes active
        showDockIcon()
    }

    private func hideDockIcon() {
        // Hide the Dock icon when the app window is closed.
        //
        // This is only triggered by NSWindow.willCloseNotification, never by
        // didResignActive: switching to .accessory deactivates the app and sends
        // its window behind other apps. During launch the app window isn't
        // reliably visible yet, so hiding on an early resign-active made the
        // window "disappear" behind other windows.
        NSApp.setActivationPolicy(.accessory)
    }
    
    private func showDockIcon() {
        // Show the Dock icon when the main window becomes active
        NSApp.setActivationPolicy(.regular)
    }
    
    /// Set the connection status in the app's menu in the system-wide menu bar.
    @objc public func _AppKitBridge_setConnectionStatus(_ status: ConnectionStatus) {
        if statusItemController == nil {
            NSLog("[AppKitController] No status item controller found. Creating one now.")
            statusItemController = StatusItemController()
        }
        statusItemController!.setStatus(status: status)
    }
}

extension NSWindow {
    /// Whether this is the app's window, the one that shows the web UI.
    ///
    /// The app has a single UIKit scene, which Catalyst hosts in the app's only
    /// standard window: it has a title bar and is not a panel. Every other
    /// window in the process is borderless or a panel: the status item's, alerts,
    /// and the helper windows Catalyst creates, including one that it opens and
    /// closes during launch. Treating that one as the app window would hide the
    /// Dock icon at launch, which sends the real window behind other apps.
    ///
    /// The window is recognized by these properties because nothing public maps
    /// a UIKit scene to its NSWindow, and the UIKit side cannot do this work
    /// itself: with a single scene, closing the window sends no scene
    /// notification (the scene stays connected and active), and
    /// UIApplication.requestSceneSessionActivation cannot bring it back.
    var isAppWindow: Bool {
        return styleMask.contains(.titled) && !(self is NSPanel)
    }
}
