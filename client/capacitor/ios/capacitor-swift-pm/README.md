# capacitor-swift-pm (local)

Local stand-in for [ionic-team/capacitor-swift-pm](https://github.com/ionic-team/capacitor-swift-pm), used by the Mac Catalyst build only (see `../App/OutlineMacOS.xcworkspace` and `client/capacitor/README.md`).

The upstream package vends `Capacitor.xcframework` and `Cordova.xcframework` with iOS and iOS Simulator slices only. `build_xcframeworks.sh` builds the same two frameworks from the Capacitor sources at the installed `@capacitor/ios` version, adding a Mac Catalyst slice, and writes them next to `Package.swift` (gitignored). Because the package name and products match the upstream package, Xcode resolves every `capacitor-swift-pm` dependency in the graph (CapApp-SPM and the Capacitor plugins) to this package when the workspace includes it.

Rebuild after upgrading `@capacitor/ios`:

```sh
client/capacitor/ios/capacitor-swift-pm/build_xcframeworks.sh --force
```
