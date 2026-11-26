# Electron Development Instructions

Unlike the Android and Apple clients, the Windows and Linux clients use the Electron framework, rather than Cordova.

To build the Electron clients, run (it will also package an installer executable into `output/client/electron/build`):

```sh
npm run action client/electron/build [windows|linux] -- --arch=[x64|ia32|arm64]
```

To run the Electron clients, run:

```sh
npm run action client/electron/start [windows|linux] -- --arch=[x64|ia32|arm64]
```

## Cross-Compiling

Install [Zig 0.13.0](https://ziglang.org/download/#release-0.13.0) for your host and put `zig` on your PATH. CI uses this version for the Go backend and the Windows DNS helper.

On an M-series ARM Macs it is necessary to install Rosetta to allow the chip to run x86_64 commands. (A code-signing step in our windows build uses an intel version of wine.)

```sh
softwareupdate --install-rosetta --agree-to-license
```

## Building the Windows service and DNS helper

Windows debug and release installers build `OutlineService.exe` and `smartdnsblock.exe` from source. Install the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) alongside Zig on your Windows, Linux, or macOS build host. The SDK restores the .NET Framework 4.8 reference assemblies from NuGet to compile the C# service. Zig supplies the Windows headers and import libraries for the C++ DNS helper.

After `npm ci`, you can build the two executables directly from the repository root.

```sh
npm run action client/electron/windows/build_service
```

Both the ia32 and arm64 installers ship the x86 executables from `output/client/windows-service/bin/`. The build signs both with the configured Windows signing credentials before NSIS packages them. Packaging a full ia32 installer on Linux also requires Wine with 32-bit support.

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
npx asar list 'output/client/electron/build/win-ia32-unpacked/resources/app.asar'
```
