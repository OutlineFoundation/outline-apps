# Outline Client Apple Development Instructions

This document describes how to develop and debug the native side of the Outline Client for iOS and macOS. Both are built from the Capacitor project in [`client/capacitor`](../capacitor); for the requirements and the build commands, see the [Capacitor client README](../capacitor/README.md).

## Layout

- [`client/capacitor/apple/App`](../capacitor/apple/App): the Xcode project of the app (`App.xcodeproj`, scheme `Outline`), built for iOS and, through Mac Catalyst, for macOS. It embeds the `VpnExtension` target from `OutlineLib` and links the Outline plugin through the Swift package `App/CapApp-SPM`, which `cap sync ios` regenerates.
- [`OutlineLib`](./OutlineLib): the `VpnExtension` network extension (`PacketTunnelProvider`) and its unit tests (`VpnExtensionTest`).
- [`OutlineAppleLib`](./OutlineAppleLib): the Swift package shared by the app, the plugin and the extension: tunnel management (`OutlineTunnel`), error codes (`OutlineError`), Sentry logging and error reporting (`OutlineSentryLogger`), the VPN status notifications (`OutlineNotification`) and the Mac Catalyst bootstrap (`CatalystAppIntegration`).
- The plugin, which adapts `OutlineAppleLib` to Capacitor, is in [`client/capacitor/plugins/capacitor-plugin-outline/ios`](../capacitor/plugins/capacitor-plugin-outline/ios).
- The app and the extension link `Tun2socks.xcframework` from `output/client/apple/`, which `npm run action client/go/build ios` produces (`cap sync ios` runs it for you).

## Opening the Xcode Project

```sh
npm run action client/capacitor/web_build ios
cd client/capacitor
npx cap sync ios
npx cap open ios
```

Changes made in Xcode to the app, `OutlineLib` and `OutlineAppleLib` are made in their version-controlled location; nothing needs to be copied back.

## Configure code signing

Apple is quite particular when it comes to making sure your app is properly signed, even in development.

1. In Xcode, make sure you are logged into your Apple Developer account and that your personal devices are registered to it. Go to **Settings > Accounts** and make sure your account is set.
1. Select the "App" target in the left navigation bar and go to the "Signing & Capabilities" tab.

### Internal Contributors

1. Ensure that the Outline Foundation team is selected for "Team".
1. Do the same for the "VpnExtension" target.

### External Contributors

For **release builds via the command line**, set the `DEVELOPMENT_TEAM` environment variable (the app target has no team of its own):

```sh
DEVELOPMENT_TEAM=<your_team_id> npm run action client/capacitor/build ios -- --buildMode=release --versionName=<version>
DEVELOPMENT_TEAM=<your_team_id> npm run action client/capacitor/build macos -- --buildMode=release --versionName=<version>
```

For **development in Xcode**:

1. Select the "Team" for your own account.
1. Change the bundle identifier (e.g. `org.outline.ios.client`) to something unique.
1. Remove the app group `group.org.getoutline.client`.
1. Do the same for the "VpnExtension" target.

## Running the App

### Specify the Run Destination

- Run on your macOS computer: **Product > Destination > My Mac (Mac Catalyst)**. This is the macOS client.
- Run on a simulator. This is helpful to test the UI, but the VPN doesn't work on simulators.
- **(Best for iOS)** Run on a physical iOS device. You will need to enable development mode on the device and register it in your developer account.

See [Devices and Simulator](https://developer.apple.com/documentation/xcode/devices-and-simulator) for details on running on a physical iOS device or the simulator.

### Build and Start the App

Either run from Xcode (**Product > Run** or <kbd>⌘</kbd> <kbd>R</kbd>), or from the command line:

```sh
cd client/capacitor
npx cap run ios
```

## Test

The `VpnExtension` unit tests run on an iOS simulator or on the Mac (Mac Catalyst):

```sh
npm run action client/apple/test ios
npm run action client/apple/test macos
```

## Inspect Logs

The app bundle is named `App.app` (its display name is Outline), which is what the predicates below match.

The easiest way to inspect logs is to use the `log` command. To see the client app logs in real time, you can use `log stream` with a `--predicate` flag to select the messages sent by the Outline code:

```sh
log stream  --info --predicate 'senderImagePath contains "/App.app"'
```

In the Console app, select the **Action > Include Info Messages** manu, and set the filter to "Library Path" "contains" "/App.app":

<img width="1371" alt="image" src="https://github.com/OutlineFoundation/outline-apps/assets/113565/812c9e14-be11-4a64-b90f-58a4bac138b1">

> 💡 Tip: You can **save searches** in the MacOS Console app.

For further debugging, you can include relevant messages from the Network Extension subsystem:
```sh
log stream  --info --predicate 'senderImagePath contains "/App.app" or (processImagePath contains "/App.app" and subsystem contains "com.apple.networkextension")'
```

To see past logs use `log show` and the `--last` flag.

Private values are redacted from Apple system logs by default. To include private debug values while developing, run:

```sh
sudo log config --mode "private_data:on"
```

Restore the default redaction behavior when you are done:

```sh
sudo log config --mode "private_data:off"
```

For details on Apple logging, see [Your Friend the System Log](https://developer.apple.com/forums/thread/705868/) and [Mac Logging and the log Command: A Guide for Apple Admins](https://blog.kandji.io/mac-logging-and-the-log-command-a-guide-for-apple-admins#:~:text=The%20log%20command%20is%20built,(Press%20q%20to%20exit.)).


## Debug the Vpn Extension
The VpnExtension runs in a separate process and its output is not logged to the Xcode console. To view its log statements see the "Inspect Logs" section.

XCode doesn't automatically attach to the VpnExtension because it's started on demand by the system.

- If the Vpn Extension is running:
  - In XCode, select **Debug > Attach to Process > VpnExtension**
- If the VpnExtension is not running:
  - In Xcode, select **Debug > Attach to Process by PID or Name…**
  - Fill **PID or Process Name** with `VpnExtension` and press **Attach**

You won't see the log messages in the Xcode console. To see the messagges, refer to the "[Inspect Logs](#Inspect-Logs)" instructions.
For more info, see [Debug, Profile, and Test Your App Extension](https://developer.apple.com/library/content/documentation/General/Conceptual/ExtensibilityPG/ExtensionCreation.html#//apple_ref/doc/uid/TP40014214-CH5-SW8).

### Debug `VpnStartFailure`

Sometimes the app will refuse to connect, with a `VpnStartFailure` error:

<img width="283" alt="image" src="https://github.com/OutlineFoundation/outline-apps/assets/113565/5f6ff845-8be3-431d-a40c-98bcfbd6ec8a">

If that happens, it may be the case that the app is trying to use the wrong version of the plugin.

To fix, run:

```sh
pkill -9 VpnExtension
pluginkit -Amv | cut -f 4 | grep VpnExtension.appex | while IFS= read -r p; do pluginkit -r "$p"; done;
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -gc
```

This will kill any running VPN extension, unregister all versions of the Outline VPN plugin and garbage collect the Launch Services database.

#### Delete the existing VPN configuration

You may want to also delete the VPN configurations:
1. Open the System Settings
1. Go to *VPN*
1. Press the Info button for the Outline service
1. Press *Remove Configuration…* and confirm

#### Restart

If all fails, restart your device. That usually takes care of the issue.

## Debug the web UI

Debug builds make the app's WebView inspectable (see `OutlineViewController.swift`):

1. In Safari, enable the Develop menu: **Settings > Advanced > Show features for web developers**.
1. Run a debug build of the app on a simulator, a device connected to your Mac, or the Mac itself.
1. In Safari, open **Develop > [device or Mac] > Outline** to attach the Web Inspector.

To reload the UI without re-running the application, reload from the Web Inspector.
