# Outline Client Apple Development Instructions

This document describes how to develop and debug the Outline Client for iOS and MacOS.

## Getting Started

You will need:

- Node (`lts/hydrogen` - [download](https://nodejs.org/en/download/)),
- An Apple Device and Developer Account.
- XCode 15.2 ([download](https://developer.apple.com/xcode/))
- XCode command line tools: `xcode-select --install`

## Initalizing the XCode Project

The XCode project is assembled by Cordova. To initialize and open the **iOS** project, run the following commands:

```sh
npm run action client/src/cordova/setup ios
open ./client/src/cordova/apple/client.xcworkspace
```

For **macOS**:

```sh
npm run action client/src/cordova/setup macos 
open ./client/src/cordova/apple/client.xcworkspace
```

> [!NOTE] 
> Should you encounter issues with your build, there may be apple-specific dependencies that are out of date.
> Run `npm run reset` and try again!

## Configure code signing

Apple is quite particular when it comes to making sure your app is properly signed, even in development.

1. In XCode, make sure you are logged into your Apple Developer account and that your personal devices are registered to it. Go to **Preferences > Accounts** and make sure your account is set.
1. Select the "Outline" target in the left navigation bar and go to the "Signing & Capabilities" tab.

### Internal Contributors

1. Ensure that the "Jigsaw Operations LLC" option is selected for "Team".
1. Do the same for the "VPN Extension" target.

### External Contributors

1. Select the "Team" for your own account.
1. Change the bundle identifier (e.g. `org.outline.ios.client`) to something unique.
1. Remove the app group `group.org.getoutline.client`.
1. Do the same for the "VPN Extension" target.

## Running the App

### Specify the Run Destination

For the **iOS** client, you have a few options:
- Run on your macOS computer: **Product >> Destination >> My Mac (Mac Catalyst)**
- Run on a simulator
  - This is helpful to test the UI, but the VPN doesn't work on simulators, so this option is not recommended.
- **(Best)** Run on a physical iOS device
  - This is the best option to evaluate how the app performs on a real device. Remember, you will need to enable development mode on the device and register it in your developer account.

See [Devices and Simulator](https://developer.apple.com/documentation/xcode/devices-and-simulator) for details on running on a physical iOS device or the simulator.

> You may find that your iOS version is _too modern_ for XCode. You'll need to do the following:
>
> 1. Download a folder corresponding to your iOS version from [this community-managed repository](https://github.com/iGhibli/iOS-DeviceSupport/tree/master/DeviceSupport).
> 2. Unzip the file and add it to XCode:
>
> ```
> Applications >> Xcode >> Right Click >> Show Package Contents >> Contents >> Developer >> Platforms >> iPhoneOS.platform >> DeviceSupport
> ```

3. Restart XCode.

For the **macOS** client, you can simply select your macOS computer: **Product > Destination > My Mac**.

### Build and Start the App

1. First **clean the build** (**Product >> Clean Build Folder…** or <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>K</kbd>)

> [!WARNING]
> If you don't clean the build first, it will fail with `Command CodeSign failed with a nonzero exit code`.

1. **Run** (**Product >> Run** or <kbd>⌘</kbd> <kbd>R</kbd>), via the menu or the play button:

<img width="802" alt="image" src="https://github.com/OutlineFoundation/outline-sdk/assets/113565/f3289c08-5f33-423a-a496-d5d764f4fce0">


## Development

Most of the Apple-specific development can happen directly on XCode. However, if you edit files in the generated `platforms/ios`, you will need to copy your changes to the appropriate version-controlled location at [`src/cordova/apple/xcode`](./xcode) or [`src/cordova/plugin/apple`](../plugin/apple).

Changes to the [OutlineAppleLib](./OutlineAppleLib) package don't need to be copied, since the package is linked by the XCode workspace and the changes happen in the original location.

## Inspect Logs

The easiest way to inspect logs is to use the `log` command. To see the client app logs in real time, you can use `log stream` with a `--predicate` flag to select the messages sent by the Outline code:

```sh
log stream  --info --predicate 'senderImagePath contains "Outline.app"'
```

In the Console app, select the **Action > Include Info Messages** manu, and set the filter to "Library Path" "contains" "Outline.app":

<img width="1371" alt="image" src="https://github.com/OutlineFoundation/outline-apps/assets/113565/812c9e14-be11-4a64-b90f-58a4bac138b1">

> 💡 Tip: You can **save searches** in the MacOS Console app.

For further debugging, you can include relevant messages from the Network Extension subsystem:
```sh
log stream  --info --predicate 'senderImagePath contains "Outline.app" or (processImagePath contains "Outline.app" and subsystem contains "com.apple.networkextension")'
```

To see past logs use `log show` and the `--last` flag.

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
for p in $(pluginkit -Amv | cut -f 4 | grep Outline); do pluginkit -r $p; done;
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

To debug the webview:

1. You may need to enable the Develop menu first, by selecting **Settings > Advanced > Show Develop menu** in menu bar
1. In your terminal, run `defaults write org.outline.ios.client WebKitDeveloperExtras -bool true`.  This is only needed once, to make the Outline webview debuggable.  You may need to re-run the whole Outline app (use Cmd+R).
1. In the Outline Client app, right click → Inspect Context. This will open the Safari debugger

To reload the UI without re-running the application, right-click → Reload.
