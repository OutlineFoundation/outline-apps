#!/bin/bash
# Scenario 08 (orphan tunnel after force-stop):
#   1. From OFF, connect via app server 1.
#   2. force-stop the package (simulates a crash / OOM kill mid-connection).
#   3. Re-launch the app, tap CONNECT again.
#   4. Inspect 'ip addr' for tun* interfaces and dumpsys connectivity for
#      NetworkAgentInfo entries owned by us.
#
# Expected (the bug): a new tun device is created and registered as a
# NetworkAgentInfo, but the previous one is NOT torn down. State after run:
# multiple tun* interfaces with same 10.111.222.1/24 address, all DOWN-but-
# present, and possibly two NetworkAgentInfo entries.
#
# Root cause sketch: VpnTunnelService.startTunnel's alreadyRunning check is
# `tunnelConfig != null && tunFd != null`. After a process kill, the new
# service instance has both null, so alreadyRunning=false; startTunnel skips
# tearDownActiveTunnel and creates a fresh tunFd, leaving the kernel-level
# tun interface from the previous process alive.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/assert.sh"

count_tun() {
  "$ADB" shell ip addr 2>&1 | grep -cE "^[0-9]+: tun[0-9]+:"
}

echo "=== reset ==="
bash "$HERE/reset_clean.sh"

echo
echo "=== baseline tun* count ==="
echo "  tun interfaces: $(count_tun)"

echo
echo "=== app-connect server 1 ==="
"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 2
"$ADB" shell input tap 885 531
expect_state true true 15 || exit 1
echo "  tun interfaces: $(count_tun)"

echo
echo "=== force-stop the app (simulate crash) ==="
"$ADB" shell am force-stop "$PKG"
sleep 2
echo "  tun interfaces immediately after: $(count_tun)"
bash "$HERE/state.sh" | sed 's/^/  /'

echo
echo "=== re-launch + reconnect server 1 ==="
"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 2
"$ADB" shell input tap 885 531
sleep 4
echo "  tun interfaces after reconnect: $(count_tun)"
bash "$HERE/state.sh" | sed 's/^/  /'

echo
echo "=== second clean disconnect via app ==="
"$ADB" shell input tap 885 531
sleep 6
echo "  tun interfaces after disconnect: $(count_tun)"
bash "$HERE/state.sh" | sed 's/^/  /'

echo
echo "=== Outline-owned NetworkAgentInfo entries ==="
"$ADB" shell dumpsys connectivity 2>&1 \
  | grep -oE "ni\{VPN CONNECTED extra: VPN:$PKG\}" \
  | wc -l \
  | xargs printf "  count: %d\n"
