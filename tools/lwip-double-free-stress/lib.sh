# shellcheck shell=bash
# Shared adb helpers for the lwIP double free stress test. Source, don't run.

ANDROID_HOME="${ANDROID_HOME:-${HOME}/Library/Android/sdk}"
ADB_BIN="${ADB_BIN:-${ANDROID_HOME}/platform-tools/adb}"
# Every adb call gets a timeout: the emulator can freeze under load, and a
# frozen emulator must fail the step instead of hanging the script.
adb_t() { perl -e 'alarm shift; exec @ARGV' "${ADB_TIMEOUT:-60}" "${ADB_BIN}" "$@"; }
ADB="adb_t"
PACKAGE="org.outline.android.client"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/out}"

log() { printf '[stress] %s\n' "$*" >&2; }
die() { printf '[stress] FAIL: %s\n' "$*" >&2; exit 1; }

# device_alive: fails if the emulator no longer answers adb.
device_alive() { [[ "$(ADB_TIMEOUT=15 adb_t shell echo alive 2>/dev/null | tr -d '\r')" == "alive" ]]; }

require_one_device() {
  local count
  count="$("${ADB}" devices | awk 'NR > 1 && $2 == "device"' | wc -l | tr -d ' ')"
  [[ "${count}" == "1" ]] || die "expected exactly one device/emulator, found ${count}"
}

wait_for_boot() {
  "${ADB}" wait-for-device
  local i
  for i in $(seq 1 120); do
    [[ "$("${ADB}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && return 0
    sleep 2
  done
  die "device did not finish booting"
}

app_pid() { "${ADB}" shell pidof "${PACKAGE}" 2>/dev/null | tr -d '\r'; }

# The launcher activity differs between the Cordova and Capacitor apps, so
# resolve it rather than hardcode it. (`monkey` fails on some emulator images.)
launch_app() {
  local activity
  activity="$("${ADB}" shell cmd package resolve-activity --brief "${PACKAGE}" | tr -d '\r' | tail -1)"
  [[ "${activity}" == */* ]] || die "could not resolve the launcher activity of ${PACKAGE}"
  "${ADB}" shell am start -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER -n "${activity}" >/dev/null
}

# screenshot <name>: saves ${OUT_DIR}/<name>.png
screenshot() {
  mkdir -p "${OUT_DIR}"
  "${ADB}" exec-out screencap -p > "${OUT_DIR}/$1.png"
  log "screenshot: ${OUT_DIR}/$1.png"
}

# ui_dump <name>: saves the accessibility tree to ${OUT_DIR}/<name>.xml
ui_dump() {
  mkdir -p "${OUT_DIR}"
  "${ADB}" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  "${ADB}" exec-out cat /sdcard/ui.xml > "${OUT_DIR}/$1.xml"
  log "ui dump: ${OUT_DIR}/$1.xml"
}

# installed_version: prints "versionCode versionName" of the installed app.
installed_version() {
  "${ADB}" shell dumpsys package "${PACKAGE}" \
    | tr -d '\r' \
    | awk '/versionCode=/ {sub(/.*versionCode=/, ""); code=$1} /versionName=/ {sub(/.*versionName=/, ""); name=$1} END {print code, name}'
}

# ui_texts: prints "<text>\t<center-x> <center-y>" for every node with text
# (or a content description) in the current accessibility tree, WebView
# content included.
ui_texts() {
  # Delete the previous dump first: if this dump fails, we must not read a
  # stale tree from an earlier screen (or an earlier app).
  "${ADB}" shell rm -f /sdcard/ui.xml
  "${ADB}" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  "${ADB}" exec-out cat /sdcard/ui.xml 2>/dev/null | python3 -c '
import re, sys
import xml.etree.ElementTree as ET
for node in ET.fromstring(sys.stdin.read()).iter("node"):
    label = node.get("text") or node.get("content-desc")
    if not label:
        continue
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    print(f"{label}\t{(x1 + x2) // 2} {(y1 + y2) // 2}")
'
}

# ui_has_text <text>: succeeds if a node's text contains <text> (case-insensitive).
ui_has_text() {
  ui_texts | cut -f1 | grep -qiF -- "$1"
}

# wait_for_text <text> [timeout-seconds]
wait_for_text() {
  local i
  for i in $(seq 1 "${2:-30}"); do
    ui_has_text "$1" && return 0
    sleep 1
  done
  die "timed out waiting for text: $1"
}

# tap_text <text>: taps the center of the first node whose text equals <text>
# (case-insensitive).
tap_text() {
  local point
  point="$(ui_texts | awk -F'\t' -v want="$1" 'tolower($1) == tolower(want) {print $2; exit}')"
  [[ -n "${point}" ]] || die "no node with text: $1"
  # shellcheck disable=SC2086
  "${ADB}" shell input tap ${point}
}

# ui_has_exact_text <text>: succeeds if a node's text is exactly <text>
# (case-sensitive), so "Connected" does not match "Disconnected".
ui_has_exact_text() {
  ui_texts | cut -f1 | grep -qxF -- "$1"
}

# wait_for_exact_text <text> [timeout-seconds]: like wait_for_text, but
# returns 1 on timeout instead of aborting, so callers can branch on it.
wait_for_exact_text() {
  local i
  for i in $(seq 1 "${2:-30}"); do
    ui_has_exact_text "$1" && return 0
    sleep 1
  done
  return 1
}

# has_tun0: succeeds if the VPN's tun0 interface exists. (Match tun0 exactly:
# emulator images also have an unrelated tunl0.)
has_tun0() {
  "${ADB}" shell ip -brief addr show 2>/dev/null | grep -qE '^tun0\b'
}

VPN_PROCESS="${PACKAGE}:vpn"
VPN_SERVICE="${PACKAGE}/org.outline.vpn.VpnTunnelService"

vpn_pid() { "${ADB}" shell pidof "${VPN_PROCESS}" 2>/dev/null | tr -d '\r'; }

# The service is not exported, so these need a rooted (userdebug) emulator.
# They are the same intents the Quick Settings tile sends.
vpn_start() {
  "${ADB}" shell su 0 am start-foreground-service -n "${VPN_SERVICE}" --ez startLastTunnel true >/dev/null
}
vpn_stop() {
  "${ADB}" shell su 0 am startservice -n "${VPN_SERVICE}" --ez stopActiveTunnel true >/dev/null
}

# wait_tun0 <up|down> [timeout-seconds]: returns 1 on timeout.
wait_tun0() {
  local i
  for i in $(seq 1 $(( ${2:-15} * 4 ))); do
    if has_tun0; then [[ "$1" == "up" ]] && return 0; else [[ "$1" == "down" ]] && return 0; fi
    sleep 0.25
  done
  return 1
}

# The stress phase uses a copy of fakess running on the device's loopback.
# (The emulator's 10.0.2.2 NAT freezes the emulator under thousands of
# connections, and `adb reverse` does not carry TCP half-closes.)
device_fakess_start() {
  "${ADB}" reverse --remove-all >/dev/null 2>&1 || true
  "${ADB}" shell 'pkill fakess; sleep 0.3; cd /data/local/tmp && (nohup ./fakess -norelay > fakess.log 2>&1 &)' >/dev/null 2>&1
  sleep 1
  "${ADB}" shell pidof fakess >/dev/null || die "fakess did not start on the device"
}

# restart_emulator: kills a frozen emulator and boots it again. The AVD must be
# a rooted (userdebug) image; override with AVD=<name>.
restart_emulator() {
  log "restarting the emulator"
  pkill -f "platform-tools/adb shell" || true
  pkill -f qemu-system || true
  sleep 3
  pkill -9 -f qemu-system || true
  sleep 1
  (nohup "${ANDROID_HOME}/emulator/emulator" -avd "${AVD:-outline-spike}" -no-boot-anim \
    -no-snapshot-save -cores 4 -memory 4096 > "${OUT_DIR}/emulator.log" 2>&1 &)
  ADB_TIMEOUT=180 "${ADB}" wait-for-device
  wait_for_boot
  sleep 8
}

# clean_app_state: stops the app and its :vpn process so the next cycle starts
# from a fresh process, whatever state the previous one ended in.
clean_app_state() {
  "${ADB}" shell am force-stop "${PACKAGE}" >/dev/null 2>&1
  sleep 1
}
