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

```sh
npm run action client/capacitor/build ios
```

For Android:

```sh
npm run action client/capacitor/build android
```

## Syncing Assets and Dependencies

### ⚠️ **Important: Always use the wrapper script for iOS sync!**

**DO NOT USE** `npx cap sync ios` directly! Instead, use:

```sh
npm run cap:sync:ios
```

**Why?** The Capacitor CLI auto-generates `Package.swift` and removes custom dependencies (like `CapacitorPluginOutline` and `OutlineAppleLib`) every time it runs. Our wrapper script automatically restores them after sync.

### What happens during sync:

1. Capacitor copies web assets to native projects
2. Capacitor regenerates `Package.swift` (removes custom deps)
3. **Post-sync hook** restores:
   - `capacitor-plugin-outline`
   - `OutlineAppleLib`
   - `OutlineVPNExtensionLib`
   - iOS platform version (15.5)
