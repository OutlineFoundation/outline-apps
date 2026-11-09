# lwIP TCP double free stress test

**Throwaway diagnostics, not for `master`.** Written for
OutlineFoundation/outline-apps#2941 to compare an Android debug build with the
go-tun2socks fix (#2942) against one built from `master`'s Go dependencies.

It needs one rooted emulator (a `userdebug` image without Google Play; the VPN
service is not exported, so starting and stopping it by intent needs root)
with at least 4 cores and 4 GB, Node 22 and JDK 21.

## What it found

The crash needs two things in one VPN session:

1. **A close race.** A connection is closed by the app (FIN or RST) at the
   same moment its server side closes. In go-tun2socks v1.16.11 `CloseWrite`
   changes the Go state under the conn lock, drops it, and only then takes the
   lwIP lock to call `tcp_shutdown(conn.pcb)`. If lwIP frees that pcb in
   between and a new connection gets the same memory, the shutdown sends a FIN
   on the new, unrelated connection.
2. **Time.** The unrelated connection's app sees EOF and closes. Its pcb goes
   to TIME_WAIT while the Go conn stays registered, and lwIP frees it silently
   after 2*MSL (120s). The next teardown aborts every registered conn and
   calls `tcp_abort` on the freed pcb.

`run_race.sh` drives exactly that. `stressclient -mode race` also detects step
1 directly: its idle "victim" connections go to a target that never sends or
closes, so any victim that reads EOF was hit.

## Pieces

- `fakess/` is a Shadowsocks TCP server. It serves the stress traffic itself:
  the target port picks how the fake target behaves (close at a fixed delay,
  silence, flood then RST, RST on first data, early close, endless download).
  `setup.sh` uses a copy on the host for the first connect (other targets are
  relayed for real, which the app's connectivity check needs) and then starts
  a copy on the device (`-norelay`) for the stress phase. The emulator's
  `10.0.2.2` NAT freezes the whole emulator under thousands of connections,
  and `adb reverse` does not carry TCP half-closes.
- `stressclient/` runs on the device through `adb shell`. It opens connections
  through the VPN to `8.8.4.4:<port>` (never reached; `fakess` answers).
  `-mode race` is the reproducing scenario; `-mode mix` is a set of weighted
  close/abort patterns that did not reproduce anything. `-seed` makes a run
  repeatable.
- `build_apk.sh <label>` builds the Capacitor debug APK from the working tree
  into `out/apks/<label>.apk` and prints which go-tun2socks module its
  `libgojni.so` contains.
- `setup.sh <apk>` clean-installs a build, adds a key for `fakess`, connects
  once through the UI, disconnects, and switches to the on-device `fakess`.
- `run_race.sh <label> [cycles] [storms]` repeats: fresh app process, start
  tunnel, race storms, wait 130s, stop the tunnel, check the `:vpn` process.
  It restarts the emulator if it freezes and discards that cycle.
- `run_comparison.sh [cycles] [storms]` runs setup and `run_race.sh` for the
  control build and then the patched build.
- `run_cycles.sh <label> [cycles] [conns]` is the earlier mix-mode loop.

## Running it

```sh
T=tools/lwip-double-free-stress
go build -o $T/out/fakess ./$T/fakess
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o $T/out/fakess-device ./$T/fakess
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o $T/out/stressclient ./$T/stressclient
$T/out/fakess &   # host copy, only used by setup.sh

# Patched build: this branch as is.
$T/build_apk.sh patched

# Control build: master's Go dependencies, everything else identical.
git checkout origin/master -- go.mod go.sum client/go/outline/electron/main.go
$T/build_apk.sh control
git checkout HEAD -- go.mod go.sum client/go/outline/electron/main.go

$T/run_comparison.sh 5 3   # about 40 minutes
```

`results/` holds the runs from 2026-11-09.
