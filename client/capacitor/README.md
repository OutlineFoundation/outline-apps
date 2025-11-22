# Capacitor Development Instructions

This document describes how to develop and debug for iOS & Android for Capacitor.

## Requirements for all builds

All builds require [Node](https://nodejs.org/) 18 (lts/hydrogen), JDK 17 and [Go](https://golang.org/) 1.22 installed in addition to other per-platform requirements.

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
```sh
SENTRY_DSN=<your sentry dsn> \
JAVA_HOME=<path to java 17> \
ANDROID_KEY_STORE_PASSWORD=<keystore password> \
ANDROID_KEY_STORE_CONTENTS=<base64 encoded keystore> \
npm run action client/capacitor/build capacitor-android -- --buildMode=release --versionName=<your version name>
```

**Note**: Release builds require:
- `versionName`: A valid version string (e.g., "1.0.0") - passed as CLI argument
- `SENTRY_DSN`: Sentry DSN for error reporting - set as environment variable
- `JAVA_HOME`: Path to JDK 17 installation - set as environment variable
- `ANDROID_KEY_STORE_PASSWORD`: Password for the signing keystore - set as environment variable
- `ANDROID_KEY_STORE_CONTENTS`: Base64-encoded keystore file contents - set as environment variable
