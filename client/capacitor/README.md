# Capacitor Development Instructions

This document describes how to develop and debug for iOS & Android for Capacitor.
Please make sure you are using JDK 17.

## Set up your environment

Install these pre-requisites:

```sh
 npm install @capacitor/cli @capacitor/core @capacitor/device @capacitor/assets
 npm install -D webpack-cli
```

## Development and Build

### Web Development (Browser)

```sh
npm run action client/capacitor/start
```

**Note**: Native plugins will not work in browser mode. Use this for UI development and testing web features.

### Build for iOS

**Debug mode:**
```sh
npm run action client/capacitor/build capacitor-ios
```

**Release mode:**
```sh
npm run action client/capacitor/build capacitor-ios -- --buildMode=release
```

For Android:

```sh
npm run action client/capacitor/build capacitor-android
```
