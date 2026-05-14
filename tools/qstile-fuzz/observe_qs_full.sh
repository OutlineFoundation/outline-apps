#!/bin/bash
# Reliable: fully expand QS via swipe, hold, then dump QSTile log lines.
set -u
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$ADB" logcat -c
bash "$HERE/open_qs_full.sh"
sleep 3

echo "=== QSTile log lines ==="
"$ADB" logcat -d 2>&1 | grep -E "QSTile|uickSettings" | sed 's/^/  /'

"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-observe-full.png >/dev/null 2>&1
echo "  screenshot: /tmp/fuzz-observe-full.png"
"$ADB" shell cmd statusbar collapse >/dev/null
