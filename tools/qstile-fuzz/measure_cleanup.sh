#!/bin/bash
# Measure how long the system takes to clear the NetworkAgentInfo after a
# clean app-driven disconnect. Helps decide reasonable timeouts for scenarios.
set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$HERE/reset_clean.sh"

echo
echo "=== ensure starting state OFF (waits up to 120s) ==="
elapsed=0
while [ "$elapsed" -lt 120 ]; do
  eval "$(bash "$HERE/state.sh")"
  if [ "$stored_vpnRunning" = "false" ] && [ "$vpn_network_present" = "false" ]; then
    echo "  ready at t=${elapsed}s"
    break
  fi
  sleep 2; elapsed=$((elapsed + 2))
done
if [ "$stored_vpnRunning" != "false" ] || [ "$vpn_network_present" != "false" ]; then
  echo "  could not reach OFF; bailing"
  bash "$HERE/state.sh"
  exit 1
fi

echo
echo "=== connect via app server 1 ==="
"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 2
"$ADB" shell input tap 885 531

elapsed=0
while [ "$elapsed" -lt 30 ]; do
  sleep 1; elapsed=$((elapsed + 1))
  eval "$(bash "$HERE/state.sh")"
  if [ "$stored_vpnRunning" = "true" ] && [ "$vpn_network_present" = "true" ]; then
    echo "  connected at t=${elapsed}s"
    break
  fi
done

echo
echo "=== disconnect via app and time the system cleanup ==="
"$ADB" shell input tap 885 531
disconnect_t=$SECONDS

elapsed=0
stored_clear_at=
network_clear_at=
while [ "$elapsed" -lt 180 ]; do
  sleep 1; elapsed=$((elapsed + 1))
  eval "$(bash "$HERE/state.sh")"
  if [ -z "$stored_clear_at" ] && [ "$stored_vpnRunning" = "false" ]; then
    stored_clear_at=$elapsed
    echo "  stored=false at t=${elapsed}s"
  fi
  if [ -z "$network_clear_at" ] && [ "$vpn_network_present" = "false" ]; then
    network_clear_at=$elapsed
    echo "  network gone at t=${elapsed}s"
    break
  fi
done

echo
echo "=== summary ==="
echo "  stored cleared after: ${stored_clear_at:-NEVER}s"
echo "  network cleared after: ${network_clear_at:-NEVER}s"
