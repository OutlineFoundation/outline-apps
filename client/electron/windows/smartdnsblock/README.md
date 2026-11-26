# `smartdnsblock`

The Windows routing service starts `smartdnsblock.exe` to block IPv4 UDP DNS traffic outside `outline-tap0`. Windows removes the filters when the helper exits.

The Windows installer builds the helper with Zig. To build it alongside the routing service on Windows, macOS, or Linux, follow the [Electron build instructions](../../README.md#building-the-windows-service-and-dns-helper).

Zig bundles MinGW-w64's Windows headers. They omit four Windows Filtering Platform GUIDs and the dynamic-session flag used by the helper. The cross-build gets those five values from [mingw_wfp.h](smartdnsblock/mingw_wfp.h). Visual Studio gets them from the Windows SDK.

To debug with Visual Studio, open [smartdnsblock.sln](smartdnsblock.sln) and build the x86 configuration. The solution writes `bin/smartdnsblock.exe` in this directory.
