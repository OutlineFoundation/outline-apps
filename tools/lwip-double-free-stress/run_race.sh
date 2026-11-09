#!/usr/bin/env bash
# Race cycles: the scenario that reproduces the lwIP TCP pcb double free.
#
# Each cycle:
#   1. start the stored tunnel;
#   2. run stressclient -mode race a few times ("storms"): connections that
#      close at the same moment as the server, next to idle "victim"
#      connections to a target that never sends or closes. A victim that sees
#      an unexpected EOF was hit by another connection's close running on a
#      freed-and-reused pcb;
#   3. keep the tunnel up for longer than lwIP's TIME_WAIT (2*MSL = 120s), so
#      lwIP frees the pcbs of the hit victims while go-tun2socks still has
#      them registered;
#   4. stop the tunnel, which aborts every registered connection, and check
#      whether the :vpn process died.
#
# Needs: setup.sh already run for this build.
#
# Usage: run_race.sh <label> [cycles] [storms-per-cycle]
# Env: RACERS (600), VICTIMS (300), STORM (8s), WAIT_SECONDS (130), SEED_START (0)
# Output: out/<label>/cycles.csv, logcat_crash.txt, tombstones/, summary.txt

set -uo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

label="${1:?usage: run_race.sh <label> [cycles] [storms]}"
cycles="${2:-5}"
storms="${3:-3}"
racers="${RACERS:-600}"
victims="${VICTIMS:-300}"
storm="${STORM:-8s}"
wait_seconds="${WAIT_SECONDS:-130}"
run_dir="${OUT_DIR}/${label}"
mkdir -p "${run_dir}/tombstones"
csv="${run_dir}/cycles.csv"
echo "cycle,vpn_pid_before,vpn_pid_after,crashed_during_storm,crashed_at_teardown,racers,victims_ok,victims_unexpected_eof,victims_unexpected_err" > "${csv}"

sum_field() { grep -ho "$1=[0-9]*" "$2" 2>/dev/null | cut -d= -f2 | paste -sd+ - | bc 2>/dev/null || echo 0; }

require_one_device
"${ADB}" shell pidof fakess >/dev/null || device_fakess_start
"${ADB}" logcat -c
"${ADB}" logcat -b crash -c
"${ADB}" shell "su 0 find /data/tombstones -type f -delete" || true
log "build under test: $(installed_version)"

seed="${SEED_START:-0}"
teardown_crashes=0
hangs=0
storm_crashes=0
total_eof=0
for cycle in $(seq 1 "${cycles}"); do
  if ! device_alive; then
    restart_emulator
  fi
  clean_app_state
  "${ADB}" shell pidof fakess >/dev/null || device_fakess_start
  launch_app
  sleep 3
  vpn_start
  if ! wait_tun0 up 20; then
    vpn_start
    wait_tun0 up 20 || { log "cycle ${cycle}: tunnel did not come up"; echo "${cycle},,,no-tunnel,,,,," >> "${csv}"; continue; }
  fi
  sleep 1
  before="$(vpn_pid)"
  out="${run_dir}/client_${cycle}.txt"
  : > "${out}"
  for _ in $(seq 1 "${storms}"); do
    seed=$(( seed + 1 ))
    ADB_TIMEOUT=90 "${ADB}" shell /data/local/tmp/stressclient -mode race -seed "${seed}" \
      -racers "${racers}" -victims "${victims}" -storm "${storm}" >> "${out}" 2>&1
  done
  device_alive || { log "cycle ${cycle}: EMULATOR FROZE during the storms; cycle discarded"; echo "${cycle},${before},,emulator-froze,,,,," >> "${csv}"; restart_emulator; continue; }
  eof="$(sum_field victims_unexpected_eof "${out}")"
  total_eof=$(( total_eof + eof ))
  mid="$(vpn_pid)"
  during=0
  [[ "${before}" != "${mid}" ]] && { during=1; storm_crashes=$(( storm_crashes + 1 )); }
  log "cycle ${cycle}: storms done, victims with unexpected EOF: ${eof}; waiting ${wait_seconds}s for TIME_WAIT to expire"
  sleep "${wait_seconds}"
  device_alive || { log "cycle ${cycle}: EMULATOR FROZE during the wait; cycle discarded"; echo "${cycle},${before},,emulator-froze,,,,," >> "${csv}"; restart_emulator; continue; }
  mid="$(vpn_pid)"
  vpn_stop
  # tun0 can outlive a clean teardown by more than 15s after a storm, so it is
  # not a sign of a hang. The service logs this line when its teardown ran to
  # the end; a missing line with an unchanged pid is a real hang.
  sleep 4
  after="$(vpn_pid)"
  closed_ok="$("${ADB}" logcat -d -t 400 2>/dev/null | grep -c "Remote device closed successfully" || true)"
  at_teardown=clean
  if [[ "${mid}" == "${after}" && "${closed_ok}" == "0" ]]; then
    at_teardown=hang
    hangs=$(( hangs + 1 ))
    log "cycle ${cycle}: HANG at teardown (no close logged, pid unchanged)"
  elif [[ "${mid}" != "${after}" ]]; then
    at_teardown=crash
    teardown_crashes=$(( teardown_crashes + 1 ))
    log "cycle ${cycle}: CRASH at teardown (vpn pid ${mid} -> ${after:-none})"
    sleep 4 # let debuggerd finish the tombstone and the app rebind the service.
  fi
  "${ADB}" logcat -b crash -d >> "${run_dir}/logcat_crash.txt" 2>/dev/null
  "${ADB}" logcat -b crash -c
  "${ADB}" logcat -d >> "${run_dir}/logcat_full.txt" 2>/dev/null
  "${ADB}" logcat -c # so the next cycle's close check only sees its own lines.
  echo "${cycle},${before},${after},${during},${at_teardown},$(sum_field racers "${out}"),$(sum_field victims_ok "${out}"),${eof},$(sum_field victims_unexpected_err "${out}")" >> "${csv}"
done

for t in $("${ADB}" shell su 0 ls /data/tombstones 2>/dev/null | tr -d '\r' | grep -v '\.pb$'); do
  "${ADB}" shell su 0 cat "/data/tombstones/${t}" > "${run_dir}/tombstones/${t}.txt"
done
{
  echo "label: ${label}"
  echo "build: $(installed_version)"
  echo "cycles: ${cycles}  storms per cycle: ${storms}  racers/victims per storm: ${racers}/${victims}"
  echo "victims with unexpected EOF (all cycles): ${total_eof}"
  echo "cycles where :vpn crashed during the storms: ${storm_crashes}"
  echo "cycles where :vpn crashed at teardown: ${teardown_crashes}"
  echo "cycles where teardown hung: ${hangs}"
  echo "tombstones for ${PACKAGE}: $(grep -l "${PACKAGE}" "${run_dir}"/tombstones/* 2>/dev/null | wc -l | tr -d ' ')"
} | tee "${run_dir}/summary.txt"
