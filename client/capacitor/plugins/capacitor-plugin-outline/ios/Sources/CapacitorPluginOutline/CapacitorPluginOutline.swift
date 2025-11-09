import Foundation
import Capacitor
import CocoaLumberjack
import CocoaLumberjackSwift
import NetworkExtension
import OutlineError
import OutlineNotification
import OutlineSentryLogger
import OutlineTunnel
import Sentry
import Tun2socks

public enum TunnelStatus: Int {
    case connected = 0
    case disconnected = 1
    case reconnecting = 2
    case disconnecting = 3
}

@objc(CapacitorPluginOutline)
public class CapacitorPluginOutline: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapacitorPluginOutline"
    public let jsName = "CapacitorPluginOutline"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "invokeMethod", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initializeErrorReporting", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "quitApplication", returnType: CAPPluginReturnPromise)
    ]
    
    private var implementation: CapacitorPluginOutlineImplementation?
    
    public override init() {
        super.init()
    }
    
    public override func load() {
        implementation = CapacitorPluginOutlineImplementation(plugin: self)
    }
    
    @objc public func invokeMethod(_ call: CAPPluginCall) {
        implementation?.invokeMethod(call)
    }
    
    @objc public func start(_ call: CAPPluginCall) {
        implementation?.start(call)
    }
    
    @objc public func stop(_ call: CAPPluginCall) {
        implementation?.stop(call)
    }
    
    @objc public func isRunning(_ call: CAPPluginCall) {
        implementation?.isRunning(call)
    }
    
    @objc public func initializeErrorReporting(_ call: CAPPluginCall) {
        implementation?.initializeErrorReporting(call)
    }
    
    @objc public func reportEvents(_ call: CAPPluginCall) {
        implementation?.reportEvents(call)
    }
    
    @objc public func quitApplication(_ call: CAPPluginCall) {
        implementation?.quitApplication(call)
    }
}

