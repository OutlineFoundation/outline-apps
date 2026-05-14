#!/bin/bash
# Assertion + wait helpers for fuzz scenarios.
# Source from a scenario script: `source "$HERE/assert.sh"`

set -u

# `expect_state STORED NETWORK [timeout_s]` waits up to TIMEOUT seconds for the
# state to match. STORED and NETWORK are "true" or "false". Returns 0 on success,
# 1 on timeout. The eventual state is always printed.
expect_state() {
  local want_stored="$1" want_network="$2" timeout="${3:-15}"
  local elapsed=0 ok=
  local stored network
  while [ "$elapsed" -lt "$timeout" ]; do
    eval "$(bash "$(dirname "${BASH_SOURCE[0]}")/state.sh")"
    stored="$stored_vpnRunning"; network="$vpn_network_present"
    if [ "$stored" = "$want_stored" ] && [ "$network" = "$want_network" ]; then
      ok=1; break
    fi
    sleep 1; elapsed=$((elapsed + 1))
  done
  if [ -n "$ok" ]; then
    echo "  PASS  stored=$stored network=$network (after ${elapsed}s)"
    return 0
  else
    echo "  FAIL  want stored=$want_stored network=$want_network  got stored=$stored network=$network (after ${timeout}s)"
    return 1
  fi
}

# `snapshot_state` prints the current state inline.
snapshot_state() {
  bash "$(dirname "${BASH_SOURCE[0]}")/state.sh" | sed 's/^/  /'
}

# `capture_qs <label>` fully expands QS and screenshots to /tmp/fuzz-qs-<label>.png.
capture_qs() {
  local label="$1"
  local adb="$ANDROID_HOME/platform-tools/adb"
  bash "$(dirname "${BASH_SOURCE[0]}")/open_qs_full.sh"
  "$adb" shell screencap -p /sdcard/s.png >/dev/null
  "$adb" pull /sdcard/s.png "/tmp/fuzz-qs-$label.png" >/dev/null 2>&1
  "$adb" shell cmd statusbar collapse >/dev/null
  echo "  screenshot: /tmp/fuzz-qs-$label.png"
}
