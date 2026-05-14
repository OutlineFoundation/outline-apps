#!/bin/bash
# Scenario 03 (cross-source toggling):
#   1. Start from OFF
#   2. Connect via app   → expect stored=true, network=true within 10s
#   3. Disconnect via tile → expect stored=false, network=false within 30s
#   4. Reconnect via tile  → expect stored=true,  network=true  within 15s
#   5. Disconnect via app  → expect stored=false, network=false within 30s
#
# Watching for: any step that ends in a state mismatch, or a step that takes
# anomalously long (the 30s window for tunnel teardown is generous; tighter
# might fail due to system NetworkAgentInfo GC delay rather than a real bug).

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/assert.sh"

echo "=== reset to disconnected ==="
bash "$HERE/reset_clean.sh"
expect_state false false 30 || exit 1

echo
echo "=== step 1: connect via app (tap server 1) ==="
"$ADB" shell input tap 885 531
expect_state true true 15

echo
echo "=== step 2: disconnect via tile ==="
bash "$HERE/open_qs_full.sh"
"$ADB" shell input tap 159 1040
sleep 0.5
"$ADB" shell cmd statusbar collapse >/dev/null
expect_state false false 30

echo
echo "=== step 3: reconnect via tile ==="
bash "$HERE/open_qs_full.sh"
"$ADB" shell input tap 159 1040
sleep 0.5
"$ADB" shell cmd statusbar collapse >/dev/null
expect_state true true 15

echo
echo "=== step 4: disconnect via app ==="
"$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1
sleep 2
"$ADB" shell input tap 885 531
expect_state false false 30

echo
capture_qs scenario-03-final
