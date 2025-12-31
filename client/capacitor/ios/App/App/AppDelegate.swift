import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    // Track if working directory has been adjusted to prevent multiple adjustments
    private var hasAdjustedWorkingDirectory = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize the main window and set OutlineViewController as root
        window = UIWindow(frame: UIScreen.main.bounds)
        let rootViewController = OutlineViewController()
        window?.rootViewController = rootViewController
        window?.makeKeyAndVisible()
        return true
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Ensure WebView is visible when app returns from background
        // viewWillAppear will also be called, but this ensures it happens immediately
        if let outlineViewController = window?.rootViewController as? OutlineViewController {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                outlineViewController.ensureWebViewVisible()
            }
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Adjust working directory for file operations (required for Go backend and native file operations)
        adjustWorkingDirectoryIfNeeded(context: "didBecomeActive")
        
        // Ensure WebView is visible when app becomes active (e.g., after unlocking device)
        // This is separate from viewWillAppear as it handles app state transitions
        if let outlineViewController = window?.rootViewController as? OutlineViewController {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                outlineViewController.ensureWebViewVisible()
            }
        }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

extension AppDelegate {
    /**
     * Adjusts the working directory to the app's bundle path.
     * This is required for some native file operations and Go backend functionality.
     * Only adjusts once per app lifecycle to avoid unnecessary operations.
     */
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
     */
    private func retryWorkingDirectoryAdjustment() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.adjustWorkingDirectoryIfNeeded(context: "retry")
        }
    }
}
