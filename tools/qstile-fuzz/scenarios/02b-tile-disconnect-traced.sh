#!/bin/bash
# Same as 02-tile-disconnect.sh but with continuous logcat capture during the tap.
# Use to investigate why the STOP intent isn't tearing down the tunnel.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== BEFORE ==="
bash "$HERE/state.sh" | sed 's/^/  /'

"$ADB" logcat -c
bash "$HERE/open_qs_full.sh"

echo
echo "=== tap tile + capture logcat for 8s ==="
"$ADB" shell input tap 159 1040
sleep 8
"$ADB" shell cmd statusbar collapse >/dev/null

echo
echo "--- VpnTunnel / QSTile / VpnService / VpnExtension logs (filtered) ---"
"$ADB" logcat -d 2>&1 \
  | grep -iE "QSTile|VpnTunnelService|VpnExtension|networkextension|VpnService.* org.outline|outline.*vpn" \
  | tail -40 | sed 's/^/  /'

echo
echo "=== final state ==="
bash "$HERE/state.sh" | sed 's/^/  /'
