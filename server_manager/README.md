# <img alt="Outline Manager Logo" src="../docs/resources/logo_manager.png" title="Outline Manager" width="32">&nbsp;&nbsp;Outline Manager

![Build and Test](https://github.com/Jigsaw-Code/outline-apps/actions/workflows/build_and_test_debug_manager.yml/badge.svg?branch=master)

## Running

To run the Outline Manager Electron app:

```
npm run action server_manager/electron/start ${PLATFORM}
```

To run the Outline Manager Electron app with a development build (code not minified):

```
BUILD_ENV=development npm run action server_manager/electron/start ${PLATFORM}
```

Where `${PLATFORM}` is one of `linux`, `macos`, `windows`.

## Development Server

To run the Outline Manager as a web app on the browser and listen for changes:

```
npm run action server_manager/www/start
```

## Debug an existing binary

You can run an existing binary in debug mode by setting `OUTLINE_DEBUG=true`.
This will enable the Developer menu on the application window.

## Packaging

To build the app binary:

```
npm run action server_manager/electron/package ${PLATFORM} -- --buildMode=[debug,release]
```

Where `${PLATFORM}` is one of `linux`, `macos`, `windows`.

The per-platform standalone apps will be at `output/build/server_manager/electron/static/dist`.

- Windows: An `.exe` file. Only generated if you have [wine](https://www.winehq.org/download) installed.
- Linux: An `.AppImage` file.
- macOS: A `.dmg` and a `.zip` file as [required by auto update](https://www.electron.build/mac#target).

> NOTE: If you are building for macOS, you may need to run `security unlock-keychain login.keychain` so electron-builder has access to your certificates.

## Error reporting

To enable error reporting through [Sentry](https://sentry.io/) for local builds, run:

```bash
export SENTRY_DSN=[Sentry DSN URL]
npm run action server_manager/electron/start ${PLATFORM}
```
