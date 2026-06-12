# Capacitor client

This directory is the Capacitor-based client shell. The sections below cover the **browser** workflow (webpack bundle under `client/capacitor/www/`) and **iOS** (native shell + Capacitor CLI).

Unless noted otherwise, run `npm run action …` from the **repository root**.

## Requirements (browser)

- [Node.js](https://nodejs.org/) 22 (see root `package.json` `engines`)
- Install dependencies after clone:

  ```sh
  npm ci
  ```

  If you use `nvm`, run `nvm use` in the repo root so the Node version matches.

## Start (development server, browser)

Runs a **browser** build once, then starts the webpack dev server (HMR):

```sh
npm run action client/capacitor/start
```

- **URL:** [http://localhost:8080](http://localhost:8080) (server binds to `0.0.0.0:8080`).
- **Live reload:** edit sources under `client/web/` and other bundled paths; the UI updates as you save.

**Note:** In pure browser mode, Capacitor native plugins are not available. The app uses a browser `MethodChannel` shim for a subset of behavior (for example parsing common static access keys). Use this for UI and web-layer development.

## Build (browser)

The build action accepts **`browser`** (see `build.action.mjs`).

**Debug (default):**

```sh
npm run action client/capacitor/build
```

**Note:** The Capacitor browser build is **debug-only**. Passing `--buildMode=release` is rejected by `build.action.mjs`.

### Output

Artifacts land in **`client/capacitor/www/`**, including for example:

- `index.html`, `bundle.js`
- `environment.json` (version and build numbers)
- Copied assets: `messages/`, `assets/`, etc. (see `webpack.config.js`)

## iOS (device or simulator)

Use this flow when you need the real Outline iOS plugin (VPN, native method channel, and so on). All **`npx cap`** commands below are run from **`client/capacitor`** (the directory that contains `capacitor.config.json` and `ios/`).

### Requirements (iOS)

- A Mac with [Xcode](https://developer.apple.com/xcode/) installed, including the Xcode command-line tools, and a recent iOS SDK.
- [CocoaPods](https://cocoapods.org/) installed (`sudo gem install cocoapods`), used to manage native iOS dependencies.
- A **physical device** with a valid provisioning profile/signing setup, or an **iOS Simulator** runtime installed via Xcode.
- **Go** on your `PATH` (`npm run capacitor:sync:before` runs **`npm run build`** to populate `www/`, then `go tool task` for tun2socks and iOS configure; see `package.json` in this directory).

### Steps to build and start the app

1. **Go to the Capacitor project directory:**
   ```sh
   cd client/capacitor
   ```
2. **Sync the iOS project** (runs `capacitor:sync:before`: webpack `www/` build, Go tun2socks, iOS configure; then copies web assets into the native app, installs CocoaPods dependencies, and refreshes plugins):
   ```sh
   npx cap sync ios
   ```
3. **Install and launch** on the default device or running simulator:
   ```sh
   npx cap run ios
   ```

### Optional Capacitor CLI commands

- **Open in Xcode** (inspect build settings, run/debug from the IDE):
  ```sh
  cd client/capacitor
  npx cap open ios
  ```
- **Web-only iteration** (faster when you did not change native code or `Info.plist`): copy assets without refreshing native CocoaPods dependencies. Build `www/` first, then copy (sync is heavier but already runs `npm run build` in `capacitor:sync:before`):
  ```sh
  cd client/capacitor
  npm run build
  npx cap copy ios
  ```
  Use **`npx cap sync ios`** again whenever you change native plugins, CocoaPods dependencies, or `Info.plist` entries.
- **Sanity check** the iOS toolchain from Capacitor's point of view:
  ```sh
  cd client/capacitor
  npx cap doctor ios
  ```
