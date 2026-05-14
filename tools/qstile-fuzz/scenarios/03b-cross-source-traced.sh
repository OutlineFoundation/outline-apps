#!/bin/bash
# Traced version of scenario 03 that snapshots a screenshot at every step,
# so failures can be diagnosed visually.
set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/assert.sh"

shot() {
  local name=$1
  "$ADB" shell screencap -p /sdcard/s.png >/dev/null
  "$ADB" pull /sdcard/s.png "/tmp/fuzz-03b-$name.png" >/dev/null 2>&1
  echo "    /tmp/fuzz-03b-$name.png"
}

echo "=== reset ==="
bash "$HERE/reset_clean.sh"
expect_state false false 30 || exit 1
shot "01-after-reset"

echo
echo "=== step 1: app-connect server 1 ==="
"$ADB" shell input tap 885 531
expect_state true true 15 || exit 1
shot "02-after-app-connect"

echo
echo "=== step 2: tile-disconnect ==="
echo "  --- pre-open screenshot ---"
shot "03-pre-open-qs"
bash "$HERE/open_qs_full.sh"
echo "  --- post-open screenshot (should show full QS w/ Outline tile ACTIVE) ---"
shot "04-after-open-qs"
echo "  --- dump uiautomator: where is the Outline tile right now? ---"
"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null
"$ADB" pull /sdcard/ui.xml /tmp/fuzz-03b-ui-pre-tap.xml >/dev/null 2>&1
grep -oE 'content-desc="Outline"[^/]*bounds="[^"]+"' /tmp/fuzz-03b-ui-pre-tap.xml | head -1 | sed 's/^/    /'
echo "  --- tap (159, 1040) ---"
"$ADB" shell input tap 159 1040
sleep 0.5
shot "05-immediately-after-tap"
"$ADB" shell cmd statusbar collapse >/dev/null
sleep 1
shot "06-after-collapse"
echo "  --- check state ---"
expect_state false false 30
