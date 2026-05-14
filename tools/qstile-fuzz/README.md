# Quick Settings tile fuzz harness

Throwaway scripts used during the May 2026 investigation of state-mismatch bugs between
the Outline Android Quick Settings tile and the in-app VPN toggle (PR 2767 follow-up
work on branch `refactor/qstile-state-tests`).

**Do not commit this directory to `master`.** It is intentionally outside any real
build pipeline; the only callers are humans driving an emulator from the CLI. Once the
underlying bugs are fixed and locked in with proper instrumented tests, this folder
should be deleted.

## Requirements

- A booted Android emulator with the Outline debug APK installed and at least one
  working access key already loaded (the scripts will *not* re-add keys).
- `$ANDROID_HOME` set; either source `~/.zshrc` before each run or invoke with that
  prefix.
- The Quick Settings tile pre-added to the active QS panel:

  ```
  adb shell cmd statusbar add-tile org.outline.android.client/org.outline.vpn.QuickSettingsTileService
  ```

## What the scripts do

- `state.sh` — print a one-shot snapshot of (a) the `vpnRunning` SharedPreferences
  flag, (b) whether an Outline-owned VPN network is present in ConnectivityManager,
  (c) whether `VpnTunnelService` is running.
- (more added as scenarios are written)

## Coordinates

All `input tap` calls use absolute pixel coordinates against a 1080×2400 emulator
screen. They are hard-coded and brittle by design — these scripts are not a
regression suite, just a fast loop for poking at the live app.
