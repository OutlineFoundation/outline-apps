#import <Capacitor/Capacitor.h>

CAP_PLUGIN(OutlinePlugin, "OutlinePlugin",
           CAP_PLUGIN_METHOD(invokeMethod, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(isRunning, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(initializeErrorReporting, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reportEvents, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(quitApplication, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(addListener, CAPPluginReturnCallback);
           CAP_PLUGIN_METHOD(removeListener, CAPPluginReturnNone);
           CAP_PLUGIN_METHOD(removeAllListeners, CAPPluginReturnNone);
);
