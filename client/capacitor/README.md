# Capacitor client (browser)

This directory is the Capacitor-based client shell. **This README documents the browser workflow only** (webpack bundle under `client/capacitor/www/`).

Run all commands from the **repository root** using `npm run action`.

## Requirements (browser)

- [Node.js](https://nodejs.org/) 22 (see root `package.json` `engines`)
- Install dependencies after clone:

  ```sh
  npm ci
  ```

  If you use `nvm`, run `nvm use` in the repo root so the Node version matches.

## Start (development server)

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

## Android (device or emulator)

Use this flow when you need the real Outline Android plugin (VPN, native method channel, and so on). All **`npx cap`** commands below are run from **`client/capacitor`** (the directory that contains `capacitor.config.json` and `android/`).

### Requirements (Android)

- [Android Studio](https://developer.android.com/studio) with a recent Android SDK (match the versions in `client/capacitor/android/variables.gradle` and root Gradle files).
- A **physical device** with USB debugging or an **AVD** emulator.
- **Go** on your `PATH` (`npm run capacitor:sync:before` runs **`npm run build`** to populate `www/`, then `go tool task` for tun2socks and Android configure; see `package.json` in this directory).

### Steps to build and start the app

1. **Go to the Capacitor project directory:**

   ```sh
   cd client/capacitor
   ```

2. **Sync the Android project** (runs `capacitor:sync:before`: webpack `www/` build, Go tun2socks, Android configure; then copies web assets into the native app and refreshes plugins):

   ```sh
   npx cap sync android
   ```

3. **Install and launch** on the default device or running emulator:

   ```sh
   npx cap run android
   ```

### Optional Capacitor CLI commands

- **Open in Android Studio** (inspect Gradle, run/debug from the IDE):

  ```sh
  cd client/capacitor
  npx cap open android
  ```

- **Web-only iteration** (faster when you did not change native code or `AndroidManifest.xml`): copy assets without refreshing native Gradle dependencies. Build `www/` first, then copy (sync is heavier but already runs `npm run build` in `capacitor:sync:before`):

  ```sh
  cd client/capacitor
  npm run build
  npx cap copy android
  ```

  Use **`npx cap sync android`** again whenever you change native plugins, Gradle, or manifest entries.

- **Sanity check** the Android toolchain from Capacitor’s point of view:

  ```sh
  cd client/capacitor
  npx cap doctor android
  ```
