# Outline Server Manager

This document provides a guide for AI and human agents working on the Outline Server Manager.

## Directory Structure

The `/server_manager` directory contains the source code for the Outline Server Manager, which is available as a web-based application and an Electron desktop application.

*   `/www`: Contains the web application that serves as the main UI for the Server Manager.
*   `/electron`: Houses the Electron-specific code for the desktop version of the Server Manager.
*   `/cloud`: Includes the APIs for interacting with cloud providers like DigitalOcean and Google Cloud Platform.
*   `/install_scripts`: Contains the shell scripts used to install and configure Outline servers on various cloud providers.

## Key Technologies

*   **Lit**: The primary UI framework for the Server Manager's web-based components.
*   **Electron**: Used to build the desktop version of the Server Manager.
*   **TypeScript**: Used for all web-based code.
*   **Shadowbox**: The core proxy component of Outline, which is managed by the Server Manager.

## Prerequisites

Ensure you have installed Node.js and have run `npm ci` in the root directory.

## Building and Running the Server Manager

The `npm run action` command is used to build and run the Server Manager.

### Web Application

*   **Build**: `npm run action server_manager/www/build`
*   **Run for development**: `npm run action server_manager/www/start`

### Electron Application

*   **Build**: `npm run action server_manager/electron/build ${PLATFORM}`
*   **Run**: `npm run action server_manager/electron/start ${PLATFORM}`
*   **Run with development build**: `BUILD_ENV=development npm run action server_manager/electron/start ${PLATFORM}`

Where `${PLATFORM}` is one of `linux`, `macos`, `windows`. If ommitted, it assumes the host platform.

### Packaging

To build the app binary:

```
npm run action server_manager/electron/package ${PLATFORM} -- --buildMode=[debug,release]
```

The per-platform standalone apps will be at `output/build/server_manager/electron/static/dist`.

## Debugging

You can run an existing binary in debug mode by setting `OUTLINE_DEBUG=true`. This will enable the Developer menu on the application window.

## Error Reporting

To enable error reporting through [Sentry](https://sentry.io/) for local builds, run:

```bash
export SENTRY_DSN=[Sentry DNS URL]
npm run action server_manager/electron/start ${PLATFORM}
```

## Testing the Server Manager

*   **Web Application**: `npm run action server_manager/test`
