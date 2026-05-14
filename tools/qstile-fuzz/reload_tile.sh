#!/bin/bash
# Force the TileService to reload by killing the app's processes (which Android
# restarts on demand). Useful after `adb install -r` over a running build.
set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"

echo "--- force-stop $PKG ---"
"$ADB" shell am force-stop "$PKG"
sleep 0.5

echo "--- open QS so SystemUI re-binds the TileService ---"
"$ADB" shell cmd statusbar collapse >/dev/null; sleep 0.3
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 0.4
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 1.2
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-after-force-stop.png >/dev/null 2>&1
echo "  screenshot: /tmp/fuzz-after-force-stop.png"
"$ADB" shell cmd statusbar collapse >/dev/null
