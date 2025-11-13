import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var hasAdjustedWorkingDirectory = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        let rootViewController = OutlineViewController()
        window?.rootViewController = rootViewController
        window?.makeKeyAndVisible()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        if let outlineViewController = window?.rootViewController as? OutlineViewController {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                outlineViewController.ensureWebViewVisible()
            }
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        adjustWorkingDirectoryIfNeeded(context: "didBecomeActive")
        
        if let window = window, let rootViewController = window.rootViewController {
            window.makeKeyAndVisible()
            rootViewController.view.setNeedsLayout()
            rootViewController.view.layoutIfNeeded()
            
            if let outlineViewController = rootViewController as? OutlineViewController {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    outlineViewController.ensureWebViewVisible()
                }
            }
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

extension AppDelegate {
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

    private func retryWorkingDirectoryAdjustment() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.adjustWorkingDirectoryIfNeeded(context: "retry")
        }
    }
}
