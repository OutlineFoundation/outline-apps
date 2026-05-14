#!/bin/bash
# Scenario: app-driven Connect on server 1; observe that the tile stays INACTIVE.
#
# Assumes the app has at least one server loaded and is currently DISCONNECTED.
# Re-run with the VPN disconnected before running.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== BEFORE ==="
bash "$HERE/state.sh" | sed 's/^/  /'

echo
echo "=== app foreground + tap CONNECT on server 1 ==="
"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 1.5
"$ADB" shell input tap 885 531

echo
for sec in 1 3 6 10; do
  sleep_total=$((sec - ${last:-0}))
  sleep "$sleep_total"; last=$sec
  echo "--- t=${sec}s ---"
  bash "$HERE/state.sh" | sed 's/^/  /'
done

echo
echo "=== tile rendered state (uiautomator + screenshot) ==="
"$ADB" shell cmd statusbar expand-settings >/dev/null
sleep 0.3
"$ADB" shell cmd statusbar expand-settings >/dev/null
sleep 0.8
"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null
"$ADB" pull /sdcard/ui.xml /tmp/ui-tile-after-app-connect.xml >/dev/null 2>&1
grep -oE 'content-desc="Outline"[^/]*' /tmp/ui-tile-after-app-connect.xml | head -1 | sed 's/^/  /'
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-01-tile-after-app-connect.png >/dev/null 2>&1
echo "  screenshot: /tmp/fuzz-01-tile-after-app-connect.png"
"$ADB" shell cmd statusbar collapse >/dev/null

echo
echo "EXPECTED: stored=true, vpn_network_present=true, tile rendered ACTIVE."
echo "OBSERVED (bug): tile stays INACTIVE despite app + dumpsys showing a live Outline VPN."
echo "Root cause: ConnectivityManager.getAllNetworks() from our own UID doesn't return"
echo "our own VPN, because the VPN excludes Outline's UID from its routing set."
