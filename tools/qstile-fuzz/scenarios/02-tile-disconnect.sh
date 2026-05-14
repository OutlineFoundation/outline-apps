#!/bin/bash
# Scenario B: with VPN currently connected (stored=true), tap the QS tile.
# Expected: tile flips to INACTIVE, VPN network goes away, app shows CONNECT.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== BEFORE ==="
bash "$HERE/state.sh" | sed 's/^/  /'

echo
echo "=== fully expand QS (swipe) + tap Outline tile (159,1040) ==="
bash "$HERE/open_qs_full.sh"
"$ADB" shell input tap 159 1040
sleep 0.4
"$ADB" shell cmd statusbar collapse >/dev/null

for sec in 1 3 6 10; do
  sleep_total=$((sec - ${last:-0}))
  sleep "$sleep_total"; last=$sec
  echo "--- t=${sec}s ---"
  bash "$HERE/state.sh" | sed 's/^/  /'
done

echo
echo "=== final tile state ==="
bash "$HERE/open_qs_full.sh"
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-02-after-tile-tap.png >/dev/null 2>&1
"$ADB" shell cmd statusbar collapse >/dev/null
echo "  screenshot: /tmp/fuzz-02-after-tile-tap.png"
