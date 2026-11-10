#!/usr/bin/env bash
# Runs the race cycles on the control build, then the same on the patched
# build. Expects out/apks/control.apk and out/apks/patched.apk (build_apk.sh)
# and fakess running on the host for the setup step.
#
# MODE=mix runs run_cycles.sh (40 cycles of 120 connections by default)
# instead of the race cycles.
#
# Usage: run_comparison.sh [cycles-per-build] [storms-per-cycle]

set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${MODE:-race}"
cycles="${1:-4}"
storms="${2:-3}"
suffix="${SUFFIX:-compare}"
# shellcheck source=lib.sh
source "${here}/lib.sh"
for build in ${BUILDS:-control patched}; do
  device_alive || restart_emulator
  "${here}/setup.sh" "${here}/out/apks/${build}.apk" || exit 1
  if [[ "${mode}" == "mix" ]]; then
    "${here}/run_cycles.sh" "${build}-mix-${suffix}" "${cycles}" "${storms}"
  else
    "${here}/run_race.sh" "${build}-race-${suffix}" "${cycles}" "${storms}"
  fi
done
