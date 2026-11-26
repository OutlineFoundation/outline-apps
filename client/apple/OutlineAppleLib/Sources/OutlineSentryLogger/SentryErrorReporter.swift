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

import Foundation
import Sentry

/// The app's error reporting, through Sentry.
public enum SentryErrorReporter {
    private static let maxBreadcrumbs: UInt = 100

    private static let platformName: String = {
        #if os(macOS) || targetEnvironment(macCatalyst)
        return "macOS"
        #else
        return "iOS"
        #endif
    }()

    /// Starts Sentry. Device details we do not collect are removed from every event.
    public static func start(dsn: String) {
        SentrySDK.start { options in
            options.dsn = dsn
            options.maxBreadcrumbs = maxBreadcrumbs
            options.beforeSend = { event in
                event.context?["app"]?.removeValue(forKey: "device_app_hash")
                if var device = event.context?["device"] {
                    device.removeValue(forKey: "timezone")
                    device.removeValue(forKey: "memory_size")
                    device.removeValue(forKey: "free_memory")
                    device.removeValue(forKey: "usable_memory")
                    device.removeValue(forKey: "storage_size")
                    event.context?["device"] = device
                }
                return event
            }
        }
    }

    /// Sends a report tagged with `uuid`, the ID of the feedback the user
    /// submitted, with the VpnExtension's recent logs from `logger` attached as
    /// breadcrumbs.
    public static func send(uuid: String, vpnExtensionLogsFrom logger: OutlineSentryLogger?) {
        logger?.addVpnExtensionLogsToSentry(maxBreadcrumbsToAdd: Int(maxBreadcrumbs / 2))
        SentrySDK.capture(message: "\(platformName) report (\(uuid))") { scope in
            scope.setLevel(.info)
            scope.setTag(value: uuid, key: "user_event_id")
        }
    }
}
