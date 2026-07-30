#!/usr/bin/env bash
# Copyright 2026 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Orchestrates the Android E2E Maestro flows against a booted emulator with
# the debug APK installed. Runs flows in dependency order and drives the
# network toggle for the Vpn.AutoReconnect scenario via adb, because
# Maestro's setAirplaneMode flips the settings value without actually
# dropping connectivity on modern API levels.
#
# Required env:
#   SS_URL       ss:// access key for the hermetic Shadowsocks server
#   SS_HOSTPORT  the server's host:port as it appears in the UI
# Optional env:
#   MAESTRO_DEVICE      device id (e.g. emulator-5556) when several are attached
#   MAESTRO_DEBUG_DIR   --debug-output directory for failure artifacts
#   SS_SERVER_LOG       ss-server log path; when set, the reconnect scenario
#                       additionally asserts the client opened a NEW connection
#                       to the server after the network was restored

set -euo pipefail
cd "$(dirname "$0")"

: "${SS_URL:?SS_URL is required}"
: "${SS_HOSTPORT:?SS_HOSTPORT is required}"

MAESTRO=(maestro)
if [[ -n "${MAESTRO_DEVICE:-}" ]]; then
  MAESTRO+=(--device "$MAESTRO_DEVICE")
fi
MAESTRO+=(test -e SS_URL="$SS_URL" -e SS_HOSTPORT="$SS_HOSTPORT")
if [[ -n "${MAESTRO_DEBUG_DIR:-}" ]]; then
  MAESTRO+=(--debug-output "$MAESTRO_DEBUG_DIR")
fi

ADB=(adb)
if [[ -n "${MAESTRO_DEVICE:-}" ]]; then
  ADB+=(-s "$MAESTRO_DEVICE")
fi

# Never leave the device in airplane mode, even on failure.
trap '"${ADB[@]}" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true' EXIT

# Vpn.AddKey, Vpn.Connect, Vpn.Disconnect (+ Net.Web server-side)
"${MAESTRO[@]}" flows/vpn-smoke.yaml

# Vpn.AutoReconnect: connected -> outage -> reconnecting -> recovered
"${MAESTRO[@]}" flows/network-change/01-connect.yaml
# Mark the server log so we can prove the post-recovery reconnect opened a
# genuinely new connection, not just that the UI flipped back to "Connected".
connections_before=0
if [[ -n "${SS_SERVER_LOG:-}" && -f "$SS_SERVER_LOG" ]]; then
  connections_before=$(grep -c "tcp connection from" "$SS_SERVER_LOG" || true)
fi
"${ADB[@]}" shell cmd connectivity airplane-mode enable
"${MAESTRO[@]}" flows/network-change/02-outage.yaml
"${ADB[@]}" shell cmd connectivity airplane-mode disable
"${MAESTRO[@]}" flows/network-change/03-recovery.yaml
if [[ -n "${SS_SERVER_LOG:-}" && -f "$SS_SERVER_LOG" ]]; then
  connections_after=$(grep -c "tcp connection from" "$SS_SERVER_LOG" || true)
  if (( connections_after <= connections_before )); then
    echo "AutoReconnect assertion failed: no new server connection after recovery" \
         "(before=$connections_before after=$connections_after)" >&2
    exit 1
  fi
  echo "AutoReconnect verified: server connections $connections_before -> $connections_after"
fi

# App lifecycle: server list survives a process restart
"${MAESTRO[@]}" flows/relaunch-persistence.yaml
