#!/usr/bin/env bash
# Runs the race cycles on the control build, then the same on the patched
# build. Expects out/apks/control.apk and out/apks/patched.apk (build_apk.sh)
# and fakess running on the host for the setup step.
#
# Usage: run_comparison.sh [cycles-per-build] [storms-per-cycle]

set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cycles="${1:-4}"
storms="${2:-3}"
# shellcheck source=lib.sh
source "${here}/lib.sh"
for build in control patched; do
  device_alive || restart_emulator
  "${here}/setup.sh" "${here}/out/apks/${build}.apk" || exit 1
  "${here}/run_race.sh" "${build}-race-compare" "${cycles}" "${storms}"
done
