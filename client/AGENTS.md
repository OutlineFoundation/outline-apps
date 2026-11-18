# <img alt="Outline Client Logo" src="../docs/resources/logo_client.png" title="Outline Client" width="32">&nbsp;&nbsp;Outline Client

This document provides a guide for AI and human agents working on the Outline Client.

## Directory Structure

The `/client` directory contains the source code for all Outline client applications. Here's a breakdown of the key subdirectories:

*   `/electron`: Contains the Electron-specific code for the desktop client, including the main process, preload scripts, and build configurations.
*   `/go`: Contains shared Go source code that is used across platforms for networking and other functionality that cannot be done on the browser.
*   `/capacitor`: Contains the Capacitor project for the mobile (iOS and Android) and macOS (via Mac Catalyst) clients: the Capacitor configuration, the Outline plugin, the web entry point and the build actions. The native projects it drives are in `/apple` and `/android`.
*   `/apple`: Contains the Xcode project of the iOS and macOS apps (`App`) and the native code it builds on: the `OutlineAppleLib` Swift package and `OutlineLib` with the VPN extension.
*   `/android`: Contains the Gradle project of the Android app: the `app` module and the `outline` library module with the VPN service.
*   `/web`: Contains the shared web-based UI, built with TypeScript. This code is used by both the Electron and Capacitor applications.

## Key Technologies

*   **Electron**: Used to build the desktop client for Windows and Linux.
*   **[Capacitor](https://capacitorjs.com/)**: Used to build the clients for macOS, iOS, Android.
*   **[Lit](https://lit.dev/)**: The UI framework for all web components in the client.
*   **TypeScript**: Used for all web-based code.
*   **Go**: Used to implement the networking and other shared code.

## Building and Running the Client

The `npm run action` command is used to build and run the client applications.

### Shared Web App Development

If you are making changes to the shared web app and do not need to test platform-specific functionality, you can test in a desktop browser by running:

```sh
npm run action client/capacitor/start
```

The app logic is located in `web/app`. UI components are located in `web/ui_components`. To work on an individual UI element, use Storybook:

```sh
npm run storybook
```

### Electron Client

*   **Build (Linux)**: `npm run action client/electron/build linux -- --arch=[x64|arm64]`
*   **Build (Windows)**: `npm run action client/electron/build windows -- --arch=[ia32|arm64]`

### Capacitor Clients

*   **Build (Android)**: `npm run action client/capacitor/build android`
*   **Build (iOS)**: `npm run action client/capacitor/build ios`
*   **Build (macOS)**: `npm run action client/capacitor/build macos`

See the [Capacitor client README](capacitor/README.md) for requirements, release builds and running on a device.

### Configuration Flags

Certain actions take configuration flags. Since they are run through `npm`, you must use the `--` separator to pass them to the underlying process. For example:

```sh
SENTRY_DSN=<your sentry dsn> DEVELOPMENT_TEAM=<your team id> npm run action client/capacitor/build macos -- --buildMode=release --versionName=<your version name>
```

## Testing the Client

*   **Web Components**: `npm run action client/web/test`
*   **Go Backend**: `go test -race -bench=. -benchtime=100ms ./client/...`
*   **VpnExtension (macOS)**: `npm run action client/apple/test macos`
*   **VpnExtension (iOS)**: `npm run action client/apple/test ios`

## Additional Resources

*   [Life of a Packet](/docs/life_of_a_packet.md): Learn how the Outline Client works.
*   [Building the Capacitor clients (iOS, macOS and Android)](capacitor)
*   [Developing for Apple (macOS and iOS)](apple)
*   [Developing for Android](android)
*   [Developing for Electron (Windows and Linux)](electron)
