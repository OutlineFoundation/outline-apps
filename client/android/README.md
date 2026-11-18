# Outline Client Android Development Instructions

This document describes how to develop and debug the native side of the Outline Client for Android. It is built from the Capacitor project in [`client/capacitor`](../capacitor); for the requirements and the build commands, see the [Capacitor client README](../capacitor/README.md).

## Layout

- [`client/capacitor/android`](../capacitor/android): the Gradle project. Its `app` module is the app (`org.outline.client.MainActivity`, the manifest, resources and the release signing configuration).
- [`outline`](./outline): the `:outline-lib` module of that project. It implements most of the native functionality and does not depend on Capacitor: the VPN service (`org.outline.vpn.VpnTunnelService`), the app's handle on it (`org.outline.vpn.OutlineVpn`), the tunnel store, the boot receiver and the Quick Settings tile. It is consumed by the plugin.
- The plugin (`org.outline.CapacitorPluginOutline`) adapts the library to Capacitor: it translates plugin calls, and owns what needs the activity (the VPN permission dialog). It is in [`client/capacitor/plugins/capacitor-plugin-outline/android`](../capacitor/plugins/capacitor-plugin-outline/android).
- The tun2socks library is consumed as a Maven artifact from `output/client/android/`, which `npm run action client/go/build android` produces (`cap sync android` runs it for you).

## Set up your environment

Install these pre-requisites:

- [Java Development Kit (JDK) 21](https://jdk.java.net/archive/). On macOS, Android Studio's bundled JDK works too:

  ```shell
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  ```

- [Android Studio](https://developer.android.com/studio), which also installs the Android SDK. Alternatively, on the command line:

  1. Set environmental variables:

      ```shell
      export ANDROID_HOME=$HOME/Library/Android/sdk
      export ANDROID_NDK=$ANDROID_HOME/ndk
      ```

  1. Install the [Android command-line tools](https://developer.android.com/studio#command-line-tools-only) and make them available on the command line:

      ```shell
      curl -o /tmp/commandlinetools.zip https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip
      unzip /tmp/commandlinetools.zip -d /tmp
      mkdir -p "$ANDROID_HOME/cmdline-tools/latest"
      mv /tmp/cmdline-tools/* "$ANDROID_HOME/cmdline-tools/latest/"
      export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin/"
      ```

  1. Install platform and build tools:

      ```shell
      sdkmanager "platforms;android-37.0" "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358"
      ```

      The NDK version must match the `ndkVersion` pin in [app/build.gradle](../capacitor/android/app/build.gradle), whose comment explains why we pin it (AGP uses it to strip the packaged native libraries).

  1. Install optional components that help development (source code, emulator and image):

      ```shell
      sdkmanager "sources;android-36" "system-images;android-36;default;arm64-v8a"
      ```

      Note: you will need the `system-images;android-36;default;x86_64` image on an Intel computer.

### Important Versions

| Component  | version  | constrained by | set in  |
|---|---|---|---|
| Android API Level | compile 37, target 36 | [Play Store](https://developer.android.com/google/play/requirements/target-sdk), androidx | [variables.gradle](../capacitor/android/variables.gradle), [outline/build.gradle](./outline/build.gradle) |
| JDK | 21 | [app/build.gradle](../capacitor/android/app/build.gradle) | install instructions |
| Gradle | see [gradle-wrapper.properties](../capacitor/android/gradle/wrapper/gradle-wrapper.properties) | Android Gradle Plugin | wrapper |
| Android Gradle Plugin (AGP) | see [build.gradle](../capacitor/android/build.gradle) | Capacitor | [build.gradle](../capacitor/android/build.gradle) |
| Android NDK | 28.2.13676358 | [native-lib stripping](../capacitor/android/app/build.gradle) | [app/build.gradle](../capacitor/android/app/build.gradle), install instructions |

## Build the app

From the repository root:

```sh
npm run action client/capacitor/build android
```

The built APK will be at `client/capacitor/android/app/build/outputs/apk/debug/app-debug.apk`. Pass `-- --verbose` for Gradle's `--info` output.

## Run the app

1. Start the emulator or connect an Android device and enable [USB debugging](https://developer.android.com/studio/debug/dev-options.html#enable).
1. From the project root, run:

   ```shell
   adb install -r -d client/capacitor/android/app/build/outputs/apk/debug/app-debug.apk
   ```

Alternatively, from `client/capacitor`, run `npx cap run android`.

## Develop code

Open `client/capacitor/android` in Android Studio (`npx cap open android` from `client/capacitor`). The `:outline-lib` module is part of that project, so IDE features (auto-complete, warnings, etc) and its instrumented tests (`./gradlew :outline-lib:connectedAndroidTest`) are available there.

### To debug the web app

Run Outline on your phone with [USB debugging enabled](https://developer.android.com/studio/debug/dev-options.html#enable), then on Chrome:

- Go to [chrome://inspect](chrome://inspect)
- Find Outline
- Click inspect
- Open the Console

### To debug Java and Kotlin code

You can debug the native code using [logcat on Android Studio](https://developer.android.com/studio/debug/logcat):

1. Start the app
1. Select the "Logcat" tab at the bottom
1. Select `org.outline.android.client` in the middle menu (it should not say "no debuggable processes")

It's also possible to use the [`logcat` command](https://developer.android.com/tools/logcat).
