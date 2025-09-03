# Android Development Instructions

This document describes how to develop and debug for Android.

The main entrypoint to Android's Java code is `client/src/cordova/plugin/android/java/org/outline/OutlinePlugin.java`

## Set up your environment

Install these pre-requisites:

- [Java Development Kit (JDK) 17+](https://jdk.java.net/archive/). On macOS:

  ```shell
  brew install openjdk@17

  # Make it visible to `java_home`
  sudo ln -sfn "$(realpath "$(brew --prefix)")/opt/openjdk@17/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk-17.jdk

  export JAVA_HOME=$(/usr/libexec/java_home -v 17.0)
  ```

- [Gradle 8.7+](https://gradle.org/install/). On macOS: `brew install gradle`.

Then we need to install and configure the Android components. You can follow the [Cordova Android Platform Guide](https://cordova.apache.org/docs/en/latest/guide/platforms/android/index.html), which uses Android Studio to configure the environment. You need an Android Studio compatible with the Android Gradle Plugin 8.3.0 (see [build.gradle](client/src/cordova/android/OutlineAndroidLib/build.gradle)) we use ([compatibility table](https://developer.android.com/studio/releases#android_gradle_plugin_and_android_studio_compatibility)).

Alternatively, you can do it on the command-line:

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
    sdkmanager "platforms;android-35" "build-tools;35.0.0" "ndk;28.2.13676358" 
    ```

1. Install optional components that help development (source code, emulator and image):

    ```shell
    sdkmanager "sources;android-35" "system-images;android-35;default;arm64-v8a"
    ```

  Note: you will need the `system-images;android-35;default;x86_64` image on an Intel computer.

For development of the OutlineAndroidLib, we recommend installing Android Studio. That also make it easier to create virtual devices and run the emulator.

You can check your environment with:

```sh
npm run action client/src/cordova/setup android
cd client
npx cordova requirements android
```

### Important Versions

| Component  | version  | constrained by | set in  |
|---|---|---|---|
| Android API Level | 35+ | [Play Store](https://developer.android.com/google/play/requirements/target-sdk) | [config.xml](../../../config.xml), [build.gradle](./OutlineAndroidLib/outline/build.gradle) |
| cordova-android | 14 | Android API Level | [package.json](../../../package.json) |
| JDK | 17 | [cordova-android](https://cordova.apache.org/docs/en/latest/guide/platforms/android/index.html#android-api-level-support) | install instruction |
| Gradle | 8.13+ | [cordova-android](https://cordova.apache.org/docs/en/latest/guide/platforms/android/index.html#android-api-level-support) | [gradle-wrapper.properties](./OutlineAndroidLib/gradle/wrapper/gradle-wrapper.properties) |
| Android Gradle Plugin (AGP) | 8.7.3 | [cordova-android](https://cordova.apache.org/docs/en/latest/guide/platforms/android/index.html#android-api-level-support) | [build.gradle](../android/OutlineAndroidLib/build.gradle) |
| Android Build Tools | 35.0.0+ | [cordova-android](https://cordova.apache.org/docs/en/latest/guide/platforms/android/index.html#android-api-level-support) | install instructions |
| Android Studio | 2023.2.1  (Iguana) | [AGP](https://developer.android.com/studio/releases#android_gradle_plugin_and_android_studio_compatibility) | |

## Build the app

To build the app for Android, run:

```sh
  npm run action client/src/cordova/build android
```

The built apk will be at: `client/platforms/android/app/build/outputs/apk/debug/app-debug.apk`.

We also support passing a `--verbose` option on cordova android:

```sh
  npm run action client/src/cordova/build android -- --verbose
```

Make sure to rebuild after modifying platform dependent files!

> 💡 NOTE: If this command ever gives you unexpected Cordova errors, try runnning `npm run reset` first.

## Run the app

1. Start the simulator or connect an Android device and enable [USB debugging](https://developer.android.com/studio/debug/dev-options.html#enable).
1. From the project root, run:

   ```shell
   adb install -r -d client/platforms/android/app/build/outputs/apk/debug/app-debug.apk
   ```

Alternatively, run with:

```sh
cd client
npx cordova run android -- --gradleArg=--include-build=../../src/cordova/android/OutlineAndroidLib
```

## Develop code

Open `src/cordova/android/OutlineAndroidLib` on Android Studio. That will allow you to leverage the IDE features (auto-complete, warnings, etc) and run unit tests easily.

This project represents a library that implements most of the Outline native functionality and does not depend on Cordova. That library is imported by the "app" module that is generated by Cordova. The only native Android code outside of this library is `OutlinePlugin.java`, which integrates with CordovaLib.

To make the entire application load properly on Android Studio, you need to edit the generated `/client/platforms/android/settings.gradle` and add:

```gradle
includeBuild "../../src/cordova/android/OutlineAndroidLib"
```

### To debug the web app

Run Outline on your phone with [USB debugging enabled](https://developer.android.com/studio/debug/dev-options.html#enable), then on Chrome:

- Go to [chrome://inspect](chrome://inspect)
- Find Outline
- Click inspect
- Open the Console
- Note that all TypeScript code is browserified in a single main.cordova.js

### To debug Java code

You can debug the Java code using [logcat on Android Studio](https://developer.android.com/studio/debug/logcat):

1. Start the app
1. Select the "Logcat" tab at the bottom
1. Select `org.outline.android.client` in the middle menu (it should not say "no debuggable processes")

It's also possible to use the [`logcat` command](https://developer.android.com/tools/logcat).
