#!/bin/bash
# Rebuild the debug APK, install over the running app, force-stop so SystemUI re-binds
# the TileService, then open QS and capture logcat lines from the TileService.
#
# Run from repo root: `bash tools/qstile-fuzz/rebuild_and_observe.sh`

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK="$HERE_REPO/client/platforms/android/app/build/outputs/apk/debug/app-debug.apk"
LOG=/tmp/qstile-fuzz-android-build.log

echo "=== building (logs: $LOG) ==="
( cd "$HERE_REPO" && npm run action client/src/cordova/build android ) > "$LOG" 2>&1
build_exit=$?
grep -E "🎉|BUILD SUCCESSFUL|FAILED" "$LOG" | tail -3 | sed 's/^/  /'
if [ "$build_exit" -ne 0 ]; then
  echo "build failed (exit=$build_exit); see $LOG"; exit 1
fi

echo
echo "=== install ==="
"$ADB" install -r -d "$APK" 2>&1 | tail -2 | sed 's/^/  /'

echo
echo "=== force-stop so SystemUI re-binds the TileService with new code ==="
"$ADB" shell am force-stop "$PKG"

echo
echo "=== clear logcat, open QS, observe for 3s ==="
"$ADB" logcat -c
"$ADB" shell cmd statusbar collapse >/dev/null; sleep 0.3
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 0.4
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 2.5
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-after-rebuild.png >/dev/null 2>&1
"$ADB" shell cmd statusbar collapse >/dev/null
echo "  screenshot: /tmp/fuzz-after-rebuild.png"

echo
echo "=== QSTile log lines ==="
"$ADB" logcat -d 2>&1 | grep -E "QSTile" | sed 's/^/  /'
