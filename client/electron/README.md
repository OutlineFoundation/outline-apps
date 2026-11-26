# Electron Development Instructions

Unlike the Android and Apple clients, the Windows and Linux clients use the Electron framework, rather than Cordova.

To build and package an Electron client, run

```sh
npm run action client/electron/build [windows|linux] -- --arch=[x64|ia32|arm64]
```

To run the Electron clients, run:

```sh
npm run action client/electron/start [windows|linux] -- --arch=[x64|ia32|arm64]
```

## Cross-Compiling

Install [Zig 0.17.1](https://ziglang.org/download/#release-0.17.1) for your host and put `zig` on your PATH. CI uses this version for the Go backend and the Windows DNS helper.

On an M-series ARM Macs it is necessary to install Rosetta to allow the chip to run x86_64 commands. (A code-signing step in our windows build uses an intel version of wine.)

```sh
softwareupdate --install-rosetta --agree-to-license
```

## Building the Windows service and DNS helper

Install Go, the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and Zig on Linux, macOS or Windows. From the repository root, build the release helpers for **both** Windows targets with

```sh
go tool task client:windows:build-helpers
```

For one architecture or a debug build, select the target and mode explicitly.

```sh
go tool task client:windows:build-helpers:arm64 BUILD_MODE=debug
```

The Windows build puts the service and DNS helper in `helpers/` and the NSIS package in `installer/` under the same target directory.

| Installer | Release directory under `output/client/electron/build/` | Debug directory |
| --- | --- | --- |
| ia32 | `windows-386/` | `windows-386-debug/` |
| arm64 | `windows-arm64/` | `windows-arm64-debug/` |

Both the routing service and the DNS helper are built for the installer’s architecture. The native ARM64 service requires Windows 11 on Arm with .NET Framework 4.8.1. Use the ia32 installer on older Windows on Arm. [Microsoft’s Arm64 runtime requirements](https://devblogs.microsoft.com/dotnet/announcing-dotnet-framework-481/)

The installer build signs both helpers when Windows signing credentials are configured. On x64 Linux, install Wine with 32-bit support to package either Windows target. CI installs each Linux-built package on Windows, checks the installed helper hashes and executable architectures, and opens `OutlineServicePipe` read-only. The smoke test leaves the VPN disconnected.

## Requirements

### Windows

- Visual Studio 2022 or later

If you see an error about `node-gyp` not finding Visual Studio, try one of the following:

- (Recommended) Install the VSSetup PowerShell package using `Install-Module VSSetup -Scope CurrentUser`
- Change PowerShell LanguageMode using `$ExecutionContext.SessionState.LanguageMode="FullLanguage"`

### Linux

- `patchelf` 0.14+ is required for building the Debian package:
  - Debian/Ubuntu: `sudo apt install patchelf`
  - macOS: `brew install patchelf`
  - Windows: https://github.com/NixOS/patchelf/releases

## Release

To build the _release_ version of Windows installer, you'll also need:

- [Java 8+ Runtime](https://www.java.com/en/download/). This is required for the cross-platform Windows executable signing tool [Jsign](https://ebourg.github.io/jsign/). If you don't need to sign the executables, feel free to skip this.

## Electron Builder

The [Electron Builder config](./electron-builder.json) uses an `asarUnpack` entry. This entry
lists files for resources that must be extracted from the ASAR archive. This is necessary for files that the operating system needs to access directly, such as executable binaries that your application runs or other native modules.

To find where unpacked files are used, look for calls to `unpackedAppPath()` ([example](./app_paths.ts)).

It's helpful to list the ASAR contents to understand what's in there and what patterns to use.

For the Linux client:

```sh
npx asar list 'output/client/electron/build/linux-unpacked/resources/app.asar'
```

For the Windows client:

```sh
npx asar list 'output/client/electron/build/windows-386-debug/installer/win-ia32-unpacked/resources/app.asar'
```
