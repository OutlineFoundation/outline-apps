#!/bin/bash
# Scenario 07 (disconnect during the ~1s startup window):
#   1. From OFF, tap app CONNECT to start the VPN.
#   2. Within 800ms of the tap (before the tunnel completes), open QS and tap
#      the tile (stored is true by now, so resolveClick → STOP).
#   3. Final state should be cleanly OFF: stored=false, network eventually false.
#      Watching for: half-up tunnels, stuck "connecting" state, stored/network
#      disagreeing for longer than the normal teardown window.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/assert.sh"

echo "=== reset to disconnected ==="
bash "$HERE/reset_clean.sh"
expect_state false false 30 || exit 1

echo
echo "=== fire app CONNECT, then race a tile-disconnect ~800ms later ==="
"$ADB" shell input tap 885 531
sleep 0.8
bash "$HERE/open_qs_full.sh"
"$ADB" shell input tap 159 1040
"$ADB" shell cmd statusbar collapse >/dev/null

echo "  observe 30s for state convergence to OFF"
elapsed=0
while [ "$elapsed" -lt 30 ]; do
  sleep 2; elapsed=$((elapsed + 2))
  eval "$(bash "$HERE/state.sh")"
  echo "    t=${elapsed}s stored=$stored_vpnRunning network=$vpn_network_present"
  if [ "$stored_vpnRunning" = false ] && [ "$vpn_network_present" = false ]; then
    echo "    ✓ converged to OFF at t=${elapsed}s"
    capture_qs scenario-07-final
    exit 0
  fi
done
echo "    ✗ failed to converge to OFF after ${elapsed}s"
capture_qs scenario-07-fail
exit 1
