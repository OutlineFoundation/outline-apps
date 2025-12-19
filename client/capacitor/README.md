# Capacitor Development Instructions

This document describes how to develop and debug for iOS & Android for Capacitor.

## Requirements for all builds

All builds require [Node](https://nodejs.org/) 22 (lts/hydrogen), JDK 17 and [Go](https://golang.org/) 1.25 installed in addition to other per-platform requirements.

> 💡 NOTE: if you have `nvm` installed, run `nvm use` to switch to the correct node version!

After cloning this repo, install all node dependencies:

```sh
npm install
```

## Web Development (Browser)

```sh
npm run action client/capacitor/start
```

**Note**: Native plugins will not work in browser mode. Use this for UI development and testing web features.

## Build & Environment Setup

### Build for iOS

**Debug mode:**

```sh
npm run action client/capacitor/build capacitor-ios
```

**Release mode:**

```sh
SENTRY_DSN=<your sentry dsn> npm run action client/capacitor/build capacitor-ios -- --buildMode=release --versionName=<your version name>
```

**Note**: Release builds require:

- `versionName`: A valid version string (e.g., "1.0.0") - passed as CLI argument
- `SENTRY_DSN`: Sentry DSN for error reporting - set as environment variable

### Build for Android

**Debug mode:**

```sh
npm run action client/capacitor/build capacitor-android
```

**Release mode:**

You can either set environment variables inline or use a `.env` file in the project root:

**Option 1: Inline environment variables**

```sh
SENTRY_DSN=<your sentry dsn> \
JAVA_HOME=<path to java 17> \
ANDROID_KEY_STORE_PASSWORD=<keystore password> \
ANDROID_KEY_STORE_CONTENTS=<base64 encoded keystore> \
npm run action client/capacitor/build capacitor-android -- --buildMode=release --versionName=<your version name>
```

**Option 2: Using a `.env` file**

Create a `.env` file in the project root with:

```env
SENTRY_DSN=<your sentry dsn>
JAVA_HOME=<path to java 17>
ANDROID_KEY_STORE_PASSWORD=<keystore password>
ANDROID_KEY_STORE_CONTENTS=<base64 encoded keystore>
```

Then run:

```sh
npm run action client/capacitor/build capacitor-android -- --buildMode=release --versionName=<your version name>
```

**Note**: Release builds require:

- `versionName`: A valid version string (e.g., "1.0.0") - passed as CLI argument
- `SENTRY_DSN`: Sentry DSN for error reporting - set as environment variable or in `.env` file
- `JAVA_HOME`: Path to JDK 17 installation - set as environment variable or in `.env` file
- `ANDROID_KEY_STORE_PASSWORD`: Password for the signing keystore - set as environment variable or in `.env` file
- `ANDROID_KEY_STORE_CONTENTS`: Base64-encoded keystore file contents - set as environment variable or in `.env` file

> ⚠️ **Important**: Make sure to add `.env` to your `.gitignore` file to avoid committing sensitive credentials!

## Debugging

### Android - Chrome DevTools

To debug the Android app using Chrome DevTools:

1. **Enable USB debugging** on your Android device:

   - Go to Settings → About phone
   - Tap "Build number" 7 times to enable Developer options
   - Go to Settings → Developer options
   - Enable "USB debugging"

2. **Connect your device** via USB and ensure it's recognized:

   ```sh
   adb devices
   ```

3. **Launch the app** on your device (either via Android Studio or by installing the APK)

4. **Open Chrome DevTools**:

   - Open Chrome browser on your computer
   - Navigate to `chrome://inspect`
   - Under "Remote Target", you should see your device and the app
   - Click "inspect" next to your app to open DevTools

5. **Debug features available**:
   - Console logs and errors
   - Network requests
   - DOM inspection
   - JavaScript debugging with breakpoints
   - Performance profiling

### iOS - Safari Web Inspector

To debug the iOS app using Safari Web Inspector:

1. **Enable Web Inspector** on your iOS device:

   - Go to Settings → Safari → Advanced
   - Enable "Web Inspector"

2. **Connect your device** to your Mac via USB

3. **Launch the app** on your device (either via Xcode or by installing the app)

4. **Open Safari Web Inspector**:

   - Open Safari on your Mac
   - Go to Safari → Settings → Advanced
   - Enable "Show features for web developers" (if not already enabled)
   - In Safari menu bar, go to Develop → [Your Device Name] → [Your App Name]
   - The Web Inspector window will open

5. **Debug features available**:
   - Console logs and errors
   - Network requests
   - DOM inspection
   - JavaScript debugging with breakpoints
   - Performance timeline
   - Storage inspection (LocalStorage, IndexedDB, etc.)

**Note**: For iOS Simulator, you can also use Safari Web Inspector by selecting the simulator from the Develop menu.
