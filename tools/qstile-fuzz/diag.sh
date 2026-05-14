#!/bin/bash
# Diagnostic snapshot: open QS panel, capture logcat during open, dump SystemUI tile
# entry, dump current state. Use to investigate state-mismatch bugs.

set -u
PKG=org.outline.android.client
TILE=org.outline.vpn.QuickSettingsTileService
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== current state ==="
bash "$HERE/state.sh" | sed 's/^/  /'

echo
echo "=== open QS panel + capture logcat for 2s ==="
"$ADB" logcat -c
"$ADB" shell cmd statusbar expand-settings >/dev/null
sleep 0.3
"$ADB" shell cmd statusbar expand-settings >/dev/null
sleep 1.5
"$ADB" logcat -d 2>&1 \
  | grep -iE "$PKG|QuickSettings|VpnTunnel|TileService" \
  | sed 's/^/  /' | head -40

echo
echo "=== SystemUI tile dump entry ==="
"$ADB" shell dumpsys statusbar 2>&1 \
  | awk -v t="$TILE" 'index($0, t) > 0 { print; for (i=0;i<12;i++) { getline; print; if (/^[[:space:]]*$/) exit } }' \
  | sed 's/^/  /'

echo
echo "=== tile rendered state from uiautomator ==="
"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null
"$ADB" pull /sdcard/ui.xml /tmp/ui-tile-diag.xml >/dev/null 2>&1
grep -oE 'content-desc="Outline"[^/]*bounds="[^"]+"' /tmp/ui-tile-diag.xml | head -1 | sed 's/^/  /'

"$ADB" shell cmd statusbar collapse >/dev/null
