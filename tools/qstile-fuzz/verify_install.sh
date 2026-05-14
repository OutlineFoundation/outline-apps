#!/bin/bash
# Verify the installed APK has the new code by extracting it and grepping the dex
# for symbols only present in the latest build.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"

apk_path=$("$ADB" shell pm path "$PKG" | head -1 | tr -d '\r' | sed 's/^package://')
echo "installed APK path: $apk_path"
echo "installed APK mtime: $("$ADB" shell stat -c '%y' "$apk_path" | tr -d '\r')"

mkdir -p /tmp/fuzz-apk
"$ADB" pull "$apk_path" /tmp/fuzz-apk/app.apk >/dev/null 2>&1

echo
echo "=== signal of the FIX present in the dex ==="
# Old code: import 'android.net.ConnectivityManager' and method 'hasOutlineVpnNetwork'.
# New code: those removed; only shouldShowOn(boolean) helper remains.
strings /tmp/fuzz-apk/app.apk 2>/dev/null | grep -c "hasOutlineVpnNetwork" | sed 's/^/  hasOutlineVpnNetwork occurrences: /'
strings /tmp/fuzz-apk/app.apk 2>/dev/null | grep -c "QuickSettingsTileState" | sed 's/^/  QuickSettingsTileState occurrences: /'
# Also check via apkanalyzer if available
if command -v apkanalyzer >/dev/null 2>&1; then
  echo
  echo "=== apkanalyzer: list of QuickSettings* classes ==="
  apkanalyzer -h dex packages /tmp/fuzz-apk/app.apk 2>/dev/null | grep -i quicksettings | sed 's/^/  /'
fi
