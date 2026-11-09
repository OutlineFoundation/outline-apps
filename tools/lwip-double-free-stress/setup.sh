#!/usr/bin/env bash
# One-time setup for a build under test: clean install, add an access key for
# 127.0.0.1:19999, connect once through the UI (served by fakess on the host
# through `adb reverse`, so the app's connectivity check reaches the internet),
# which grants the VPN permission and stores the tunnel, then disconnect and
# switch 127.0.0.1:19999 to a copy of fakess running on the device. After this
# run_cycles.sh can drive the VPN service directly.
#
# Usage: setup.sh <app-debug.apk> [port] [secret]

set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apk="${1:?usage: setup.sh <apk> [port] [secret]}"
port="${2:-19999}"
secret="${3:-outline-e2e-tunnel}"
[[ -f "${apk}" ]] || die "no such file: ${apk}"

SERVER_NAME="StressTest"
userinfo="$(printf 'chacha20-ietf-poly1305:%s' "${secret}" | base64 | tr -d '=\n' | tr '+/' '-_')"
TEST_KEY="ss://${userinfo}@127.0.0.1:${port}/#${SERVER_NAME}"

require_one_device
wait_for_boot
"${ADB}" shell pkill fakess || true # a previous run's device copy holds the port.
sleep 0.5
"${ADB}" reverse "tcp:${port}" "tcp:${port}" >/dev/null

log "clean install of ${apk}"
"${ADB}" uninstall "${PACKAGE}" >/dev/null 2>&1 || true
"${ADB}" install "${apk}" >&2
log "installed: $(installed_version)"
"${ADB}" push "$(dirname "${BASH_SOURCE[0]}")/out/stressclient" /data/local/tmp/stressclient >/dev/null
"${ADB}" push "$(dirname "${BASH_SOURCE[0]}")/out/fakess-device" /data/local/tmp/fakess >/dev/null
"${ADB}" shell chmod 755 /data/local/tmp/stressclient /data/local/tmp/fakess
"${ADB}" shell pkill fakess || true

launch_app
wait_for_text "GOT IT" 60
tap_text "GOT IT"
wait_for_text "Add VPN access key"
"${ADB}" shell am start -a android.intent.action.VIEW -d "${TEST_KEY}" "${PACKAGE}" >/dev/null 2>&1
wait_for_text "${TEST_KEY}"
tap_text "CONFIRM"
wait_for_text "${SERVER_NAME}"

log "first connect through the UI"
tap_text "CONNECT"
sleep 3
if ui_has_text "Connection request"; then
  tap_text "OK"
fi
for attempt in 1 2 3; do
  if wait_tun0 up 20; then break; fi
  log "not connected yet; tapping CONNECT again"
  ui_has_exact_text "Stay protected, always" && tap_text "GOT IT"
  tap_text "CONNECT" || true
done
has_tun0 || die "could not connect through the UI"
sleep 2
ui_has_exact_text "Stay protected, always" && tap_text "GOT IT"

log "disconnecting with the service intent"
vpn_stop
wait_tun0 down 10 || die "tun0 still up after the stop intent"

log "switching to fakess on the device and checking traffic through the tunnel"
device_fakess_start
vpn_start
wait_tun0 up 15 || die "tunnel did not come back up"
sleep 1
"${ADB}" shell /data/local/tmp/stressclient -only echo -conns 3 -seed 0
vpn_stop
wait_tun0 down 10 || die "tun0 still up after the stop intent"
log "setup done"
