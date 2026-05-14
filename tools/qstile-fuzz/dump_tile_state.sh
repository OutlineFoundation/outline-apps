#!/bin/bash
# Dump SystemUI's view of the Outline tile: state ints, listening flag, etc.
# Helps tell apart "tile state desync (SystemUI cached)" vs "shouldShowOn returns wrong value".

set -u
PKG=org.outline.android.client
TILE_COMP="$PKG/org.outline.vpn.QuickSettingsTileService"
ADB="$ANDROID_HOME/platform-tools/adb"

echo "=== dumpsys statusbar — Outline tile excerpts ==="
"$ADB" shell dumpsys statusbar 2>&1 \
  | grep -B2 -A12 -i "outline" \
  | head -60 \
  | sed 's/^/  /'

echo
echo "=== shared prefs (raw) ==="
"$ADB" shell "run-as $PKG cat shared_prefs/quickSettingsTile.xml 2>/dev/null || echo MISSING" \
  | sed 's/^/  /'

echo
echo "=== last 200 lines of logcat for the package / tile ==="
"$ADB" logcat -d -t 1000 2>&1 \
  | grep -iE "$PKG|QuickSettings|VpnTunnel|TileService" \
  | tail -30 \
  | sed 's/^/  /'
