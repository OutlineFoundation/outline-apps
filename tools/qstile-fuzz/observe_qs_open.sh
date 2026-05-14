#!/bin/bash
# Open the QS panel, hold it open long enough for SystemUI to bind the TileService,
# then dump any QSTile log lines from logcat.
set -u
ADB="$ANDROID_HOME/platform-tools/adb"

"$ADB" logcat -c
"$ADB" shell cmd statusbar collapse >/dev/null; sleep 0.5
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 0.5
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 3.5

echo "=== QSTile log lines ==="
"$ADB" logcat -d 2>&1 | grep -E "QSTile|uickSettings" | sed 's/^/  /'
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-observe-qs.png >/dev/null 2>&1
echo "  screenshot: /tmp/fuzz-observe-qs.png"
"$ADB" shell cmd statusbar collapse >/dev/null
