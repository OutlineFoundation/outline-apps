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
    }
    
    private func setupWindowCloseObserver() {
        windowCloseObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let window = notification.object as? NSWindow else { return }
            
            // Check if this is the main UI window
            if self?.isMainUiWindow(window) == true {
                self?.hideDockIcon()
            }
        }
        
        // Also observe when the app becomes active/inactive to manage Dock icon
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidResignActive),
            name: NSApplication.didResignActiveNotification,
            object: nil
        )
    }
    
    @objc private func appDidBecomeActive() {
        // Show Dock icon when app becomes active
        showDockIcon()
    }
    
    @objc private func appDidResignActive() {
        // Only hide Dock icon if no windows are visible
        let hasVisibleWindows = NSApp.windows.contains { window in
            window.isVisible && isMainUiWindow(window)
        }
        
        if !hasVisibleWindows {
            hideDockIcon()
        }
    }
    
    private func hideDockIcon() {
        // Hide the Dock icon when the main window is closed
        NSApp.setActivationPolicy(.accessory)
    }
    
    private func showDockIcon() {
        // Show the Dock icon when the main window becomes active
        NSApp.setActivationPolicy(.regular)
    }
    
    /// Determines if the given window is the main UI window
    /// TODO: Decouple from the internal class name "UINSWindow" in the future
    private func isMainUiWindow(_ window: NSWindow) -> Bool {
        return String(describing: window).contains("UINSWindow")
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
