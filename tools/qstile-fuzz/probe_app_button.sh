#!/bin/bash
# Tap the server-1 action button repeatedly with screenshots, to debug why a
# tap "doesn't fire" sometimes.
set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 2

echo "--- pre-tap state + UI button bounds ---"
bash "$HERE/state.sh" | sed 's/^/  /'
"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null
"$ADB" pull /sdcard/ui.xml /tmp/fuzz-probe-app-ui.xml >/dev/null 2>&1
grep -oE 'text="(CONNECT|DISCONNECT)"[^/]*bounds="[^"]+"' /tmp/fuzz-probe-app-ui.xml \
  | head -3 | sed 's/^/  /'

echo
echo "--- tap (885, 531) — should be the server-1 action button ---"
"$ADB" shell input tap 885 531
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-probe-after-tap-0s.png >/dev/null 2>&1

for s in 1 2 3 5 8; do
  sleep "$s"
  echo
  echo "--- t=${s}s ---"
  bash "$HERE/state.sh" | sed 's/^/  /'
done
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-probe-after-tap-final.png >/dev/null 2>&1
echo "  screenshots: /tmp/fuzz-probe-after-tap-{0s,final}.png"
