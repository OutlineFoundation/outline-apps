#!/bin/bash
# Reset the emulator to a known DISCONNECTED state with the app foreground, no VPN.
# Handles the orphan-tunnel case (network present but stored=false) by absorbing
# it via a CONNECT+DISCONNECT cycle.
set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 2

read_state() {
  eval "$(bash "$HERE/state.sh")"
}
read_state

case "stored=$stored_vpnRunning network=$vpn_network_present" in
  "stored=false network=false")
    echo "  already at OFF"
    ;;
  "stored=true network=true")
    echo "  fully connected; tap app DISCONNECT (server 1)"
    "$ADB" shell input tap 885 531
    sleep 6
    ;;
  "stored=true network=false")
    # The app thinks we asked to connect but the system has no VPN. Drive stored
    # back to false via the tile so the next test starts clean.
    echo "  desync stored=true network=false; sync via tile-stop"
    bash "$HERE/open_qs_full.sh"
    "$ADB" shell input tap 159 1040
    sleep 4
    "$ADB" shell cmd statusbar collapse >/dev/null
    ;;
  "stored=false network=true")
    # Orphan: a VPN network is in the kernel but the app's intent flag is off.
    # Best way to clear: absorb via app CONNECT (replaces the orphan with a fresh
    # tunnel under our service), then tear down via app DISCONNECT.
    echo "  orphan tunnel; absorb via CONNECT then DISCONNECT"
    "$ADB" shell input tap 885 531
    sleep 6
    "$ADB" shell input tap 885 531
    sleep 6
    ;;
esac

# Re-check; we may need a second pass for stubborn orphans.
read_state
if [ "$stored_vpnRunning" != "false" ] || [ "$vpn_network_present" != "false" ]; then
  echo "  still not clean (stored=$stored_vpnRunning network=$vpn_network_present); waiting up to 30s"
  for _ in $(seq 1 30); do
    sleep 1; read_state
    [ "$stored_vpnRunning" = "false" ] && [ "$vpn_network_present" = "false" ] && break
  done
fi

echo "  reset state:"
bash "$HERE/state.sh" | sed 's/^/    /'
