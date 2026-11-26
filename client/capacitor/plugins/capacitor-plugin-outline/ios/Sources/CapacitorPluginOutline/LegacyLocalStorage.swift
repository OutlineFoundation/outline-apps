// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Foundation

#if os(iOS)
/// Copies the localStorage the app wrote under UIWebView to where WKWebView
/// looks for it, unless WKWebView already has one.
///
/// This is the WebView origin history of the Cordova app this client replaced:
/// it ran from `file://` under UIWebView and from `app://localhost` under
/// WKWebView, which Capacitor is configured to match via `server.iosScheme` so
/// that upgrading users keep their servers.
func migrateUIWebViewLocalStorage() {
    // Local storage backing files have the following naming format: $scheme_$hostname_$port.localstorage
    // With UIWebView, the app used the file:// scheme with no hostname and any port.
    let kUIWebViewLocalStorageFilename = "file__0.localstorage"
    // With WKWebView, the app uses the app:// scheme with localhost as a hostname and any port.
    let kWKWebViewLocalStorageFilename = "app_localhost_0.localstorage"

    let fileManager = FileManager.default
    let appLibraryDir = fileManager.urls(
        for: .libraryDirectory,
        in: .userDomainMask
    )[0]

    let uiWebViewLocalStorageDir: URL
    #if targetEnvironment(macCatalyst)
    guard let bundleID = Bundle.main.bundleIdentifier else {
        return
    }
    let appSupportDir = fileManager.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
    )[0]
    uiWebViewLocalStorageDir = appSupportDir.appendingPathComponent(bundleID)
    #else
    if fileManager.fileExists(
        atPath: appLibraryDir.appendingPathComponent(
            "WebKit/LocalStorage/\(kUIWebViewLocalStorageFilename)"
        ).relativePath
    ) {
        uiWebViewLocalStorageDir = appLibraryDir.appendingPathComponent("WebKit/LocalStorage")
    } else {
        uiWebViewLocalStorageDir = appLibraryDir.appendingPathComponent("Caches")
    }
    #endif
    let uiWebViewLocalStorage = uiWebViewLocalStorageDir.appendingPathComponent(kUIWebViewLocalStorageFilename)
    if !fileManager.fileExists(atPath: uiWebViewLocalStorage.relativePath) {
        return
    }

    let wkWebViewLocalStorageDir = appLibraryDir.appendingPathComponent("WebKit/WebsiteData/LocalStorage/")
    let wkWebViewLocalStorage = wkWebViewLocalStorageDir.appendingPathComponent(kWKWebViewLocalStorageFilename)
    // Only copy the local storage files if they don't exist for WKWebView.
    if fileManager.fileExists(atPath: wkWebViewLocalStorage.relativePath) {
        return
    }

    // Create the WKWebView local storage directory; this is safe if the directory already exists.
    do {
        try fileManager.createDirectory(
            at: wkWebViewLocalStorageDir,
            withIntermediateDirectories: true
        )
    } catch {
        return
    }

    // Create a tmp directory and copy onto it the local storage files.
    guard let tmpDir = try? fileManager.url(
        for: .itemReplacementDirectory,
        in: .userDomainMask,
        appropriateFor: wkWebViewLocalStorage,
        create: true
    ) else {
        return
    }
    do {
        try fileManager.copyItem(
            at: uiWebViewLocalStorage,
            to: tmpDir.appendingPathComponent(wkWebViewLocalStorage.lastPathComponent)
        )
        try fileManager.copyItem(
            at: URL(fileURLWithPath: "\(uiWebViewLocalStorage.relativePath)-shm"),
            to: tmpDir.appendingPathComponent("\(kWKWebViewLocalStorageFilename)-shm")
        )
        try fileManager.copyItem(
            at: URL(fileURLWithPath: "\(uiWebViewLocalStorage.relativePath)-wal"),
            to: tmpDir.appendingPathComponent("\(kWKWebViewLocalStorageFilename)-wal")
        )
    } catch {
        return
    }

    // Atomically move the tmp directory to the WKWebView local storage directory.
    guard (try? fileManager.replaceItemAt(
        wkWebViewLocalStorageDir,
        withItemAt: tmpDir,
        backupItemName: nil,
        options: .usingNewMetadataOnly
    )) != nil else {
        return
    }
}
#endif
