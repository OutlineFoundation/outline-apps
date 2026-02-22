# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Overview

This monorepo contains two Outline applications:
- **Outline Client** (`/client`): Cross-platform VPN/proxy client (Windows, macOS, iOS, Android, Linux) using Shadowsocks
- **Outline Manager** (`/server_manager`): Electron-based GUI for managing Outline servers

## Build System

All build/run/test tasks use `npm run action <path>`, which resolves to `.action.sh` or `.action.mjs` files relative to the repo root. Run `npm run action list` to see all available actions.

```sh
alias outline="npm run action"   # optional convenience alias
```

Pass flags to actions after `--`:
```sh
npm run action client/src/cordova/setup macos -- --buildMode=release
```

## Common Commands

```sh
npm install                                    # install dependencies (after clone)
npm run reset                                  # clean + reinstall (fixes most build issues)
npm run lint:gts                               # TypeScript lint (Linux only for whole codebase; pass filepaths on macOS)
npm run lint:lit                               # Lit-specific lint
npm run format:all                             # auto-format (Linux only)
```

### Outline Client

```sh
npm run action client/web/start                # dev server for shared web UI in browser
npm run action client/web/test                 # run web app tests
npm run storybook                              # Storybook UI component explorer (port 6006)

npm run action client/electron/start linux     # run Electron client (linux or windows)
npm run action client/electron/build linux     # build Electron client

npm run action client/src/cordova/setup ios    # init XCode project for iOS
npm run action client/src/cordova/setup macos  # init XCode project for macOS
npm run action client/src/cordova/build android  # build Android APK
```

### Outline Manager

```sh
npm run action server_manager/www/start        # dev server for manager web UI
npm run action server_manager/electron/start macos  # run manager Electron app
npm run action server_manager/test             # run manager tests
```

### Infrastructure / shared tests

```sh
npm run action infrastructure/test             # run shared TypeScript utility tests
```

## Architecture

### Shared Web UI Layer
The client UI is implemented in **Polymer 2.0** and lives in `client/src/`. It is shared across all platforms. App logic is in `client/src/app/`, UI components in `client/src/ui_components/`.

### Platform Layers
- **Cordova** (`client/src/cordova/`): wraps the web UI for iOS, macOS, Android. Native plugin code lives in `client/src/cordova/plugin/`.
- **Electron** (`client/electron/`): wraps the web UI for Windows and Linux desktop. Uses `electron-builder`.
- **Apple** (`client/src/cordova/apple/`): XCode workspace, `OutlineAppleLib` Swift package, VpnExtension runs as a separate process.
- **Android** (`client/src/cordova/android/OutlineAndroidLib/`): Android Gradle library; the only non-library native code is `OutlinePlugin.java`.

### Go Native Components
- Root `go.mod` (module `localhost`) covers all Go code in the repo.
- `client/go/` contains Go tunnel/VPN code compiled via `golang.org/x/mobile` (gomobile).
- The **config framework** (`client/go/outline/config/`) is a composable YAML-based strategy system. It uses `$type` in config maps to dispatch to registered subparsers (`TypeParser`/`ParseFunc`). New transport strategies are registered in `NewDefaultTransportProvider`.

### Manager Architecture
`server_manager/` is a self-contained npm workspace. Its Electron app hosts a web UI built with Webpack. The web layer communicates with cloud provider APIs directly from the renderer process.

### Infrastructure
`infrastructure/` is a shared npm workspace with TypeScript utilities (error handling, i18n, networking helpers) used by both apps.

## Key Requirements

| Component | Version |
|-----------|---------|
| Node.js | 22 (lts/hydrogen) – use `nvm use` if you have nvm |
| Go | 1.22+ |
| Android JDK | 17 |
| Android API Level | 35 |
| XCode | 15.2+ |

## Cross-Compilation Notes (Electron)

Building the Windows client on macOS requires **zig** (`brew install zig`) for cgo cross-compilation. On Apple Silicon, also install Rosetta (`softwareupdate --install-rosetta --agree-to-license`) since the Windows code-signing step uses an x86_64 wine binary.

## Debugging Tips

- **VPN not connecting (Apple)**: Kill stale extensions and unregister plugins:
  ```sh
  pkill -9 VpnExtension
  for p in $(pluginkit -Amv | cut -f 4 | grep Outline); do pluginkit -r $p; done
  ```
- **Apple log streaming**: `log stream --info --predicate 'senderImagePath contains "Outline.app"'`
- **Android web UI**: With USB debugging enabled, use `chrome://inspect`
- **Manager debug mode**: Set `OUTLINE_DEBUG=true` to enable the Developer menu

## Subdirectory AGENTS.md Files

More detailed platform instructions are in:
- `client/AGENTS.md` – Client overview and shared web app
- `client/electron/AGENTS.md` – Electron (Windows/Linux)
- `client/src/cordova/apple/AGENTS.md` – iOS/macOS
- `client/src/cordova/android/AGENTS.md` – Android
- `client/go/outline/config/AGENTS.md` – Go config framework
- `server_manager/AGENTS.md` – Outline Manager
