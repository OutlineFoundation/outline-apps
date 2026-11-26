# `smartdnsblock`

The Windows routing service starts `smartdnsblock.exe` to block IPv4 UDP DNS traffic outside `outline-tap0`. Windows removes the filters when the helper exits.

The Windows installer builds the helper with Zig. To build it alongside the routing service on Windows, macOS, or Linux, follow the [Electron build instructions](../../README.md#building-the-windows-service-and-dns-helper).

To debug with Visual Studio, open [smartdnsblock.sln](smartdnsblock.sln) and build the x86 configuration. The solution writes `bin/smartdnsblock.exe` in this directory.
