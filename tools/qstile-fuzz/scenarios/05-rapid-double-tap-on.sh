#!/bin/bash
# Scenario 05 (rapid double-tap from ON):
#   Starting from connected, tap the tile TWICE in quick succession.
#   Symmetric to 04: with the fix, the second tap should drive stored back to
#   true and re-START. Final state should be deterministically ON or OFF.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/assert.sh"

run_pass() {
  local label="$1" gap_ms="$2"
  echo
  echo "=== pass $label: gap=${gap_ms}ms ==="

  echo "  reset & connect via app first"
  bash "$HERE/reset_clean.sh"
  expect_state false false 30 || return 1
  "$ADB" shell input tap 885 531
  expect_state true true 15 || return 1

  echo "  open QS, double-tap tile"
  bash "$HERE/open_qs_full.sh"
  "$ADB" shell input tap 159 1040
  sleep "$(echo "$gap_ms" | awk '{printf "%.3f", $1/1000}')"
  "$ADB" shell input tap 159 1040
  "$ADB" shell cmd statusbar collapse >/dev/null

  echo "  observe 30s for state convergence"
  local elapsed=0
  while [ "$elapsed" -lt 30 ]; do
    sleep 3; elapsed=$((elapsed + 3))
    eval "$(bash "$HERE/state.sh")"
    echo "    t=${elapsed}s stored=$stored_vpnRunning network=$vpn_network_present"
    if [ "$stored_vpnRunning" = "$vpn_network_present" ]; then
      echo "    ✓ states agree at t=${elapsed}s"
      capture_qs "scenario-05-$label-final"
      return 0
    fi
  done
  echo "    ✗ states still disagree at t=${elapsed}s"
  capture_qs "scenario-05-$label-mismatch"
  return 1
}

set +e
run_pass A 200
A=$?
run_pass B 1500
B=$?
set -e

echo
echo "=== summary ==="
echo "  pass A (200ms gap): $( [ $A -eq 0 ] && echo PASS || echo FAIL )"
echo "  pass B (1500ms gap): $( [ $B -eq 0 ] && echo PASS || echo FAIL )"
