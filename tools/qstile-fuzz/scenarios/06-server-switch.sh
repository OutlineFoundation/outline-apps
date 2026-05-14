#!/bin/bash
# Scenario 06 (switch servers while connected):
#   1. From disconnected, tap server 1's CONNECT → connect to server 1
#   2. While still connected, tap server 2's CONNECT (which appears as CONNECT
#      because the app only shows DISCONNECT on the active server)
#      → expect: server 2 takes over, stored stays true throughout (or briefly
#        flickers false during the swap), VPN network stays present.
#   3. Tile should remain ACTIVE throughout (we never went through stored=false).

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/assert.sh"

echo "=== reset & connect server 1 ==="
bash "$HERE/reset_clean.sh"
expect_state false false 30 || exit 1
"$ADB" shell input tap 885 531
expect_state true true 15 || exit 1
snapshot_state

echo
echo "=== switch: tap server 2 CONNECT ==="
"$ADB" shell input tap 885 896
echo "  sampling stored/network every 1s for 12s"
for i in $(seq 1 12); do
  sleep 1
  eval "$(bash "$HERE/state.sh")"
  echo "    t=${i}s stored=$stored_vpnRunning network=$vpn_network_present"
done

echo
echo "=== expected final: stored=true, network=true (server 2 active) ==="
expect_state true true 5

capture_qs scenario-06-final
