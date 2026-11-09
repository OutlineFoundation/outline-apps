#!/usr/bin/env bash
# Runs connect / traffic / disconnect cycles against the installed build and
# records whether the :vpn process died in each one.
#
# Each cycle: start the stored tunnel, run stressclient on the device (its
# seed is the cycle number, so runs are repeatable), tear the tunnel down
# while some connections are still open, then look for a native crash.
# Every third cycle also makes fakess refuse connections for a moment, so
# some of the proxy dials fail.
#
# Needs: setup.sh already run for this build (it leaves fakess running on the device).
#
# Usage: run_cycles.sh <label> [cycles] [connections-per-cycle]
# Output: out/<label>/cycles.csv, logcat_crash.txt, tombstones/, summary.txt

set -uo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

label="${1:?usage: run_cycles.sh <label> [cycles] [conns]}"
cycles="${2:-50}"
conns="${3:-60}"
EXTRA_CLIENT_ARGS="${EXTRA_CLIENT_ARGS:-}"
run_dir="${OUT_DIR}/${label}"
mkdir -p "${run_dir}/tombstones"
csv="${run_dir}/cycles.csv"
echo "cycle,vpn_pid_before,vpn_pid_after,crashed,signal_lines,client" > "${csv}"

require_one_device
"${ADB}" shell pidof fakess >/dev/null || device_fakess_start

"${ADB}" logcat -c
"${ADB}" logcat -b crash -c
"${ADB}" shell "su 0 find /data/tombstones -type f -delete" || true
log "build under test: $(installed_version)"

crashes=0
for cycle in $(seq 1 "${cycles}"); do
  if ! has_tun0; then
    vpn_start
    if ! wait_tun0 up 15; then
      log "cycle ${cycle}: tunnel did not come up; relaunching the app and retrying"
      launch_app; sleep 3; vpn_start
      wait_tun0 up 20 || { echo "${cycle},,,setup-failed,," >> "${csv}"; continue; }
    fi
  fi
  sleep 0.5
  before="$(vpn_pid)"
  marker="stress-cycle-${cycle}-$(date +%s)"
  "${ADB}" shell log -t lwipstress "${marker}"

  (( cycle % 3 == 0 )) && "${ADB}" shell pkill -USR1 fakess
  # shellcheck disable=SC2086
  "${ADB}" shell /data/local/tmp/stressclient -seed "${cycle}" -conns "${conns}" -hold 4s ${EXTRA_CLIENT_ARGS} \
    > "${run_dir}/client_${cycle}.txt" 2>&1 &
  client=$!
  # Most patterns finish in about 2s; the held-open ones are still active here.
  sleep 2.8
  vpn_stop
  wait_tun0 down 10 || log "cycle ${cycle}: tun0 still up after stop"
  sleep 1.5
  wait "${client}" 2>/dev/null
  after="$(vpn_pid)"

  signal_lines="$("${ADB}" logcat -b crash -d 2>/dev/null | grep -cE 'Fatal signal|Scudo ERROR|signal [0-9]+ \(SIG' || true)"
  crashed=0
  if [[ "${before}" != "${after}" || "${signal_lines}" != "0" ]]; then
    crashed=1
    crashes=$(( crashes + 1 ))
    "${ADB}" logcat -b crash -d >> "${run_dir}/logcat_crash.txt" 2>/dev/null
    "${ADB}" logcat -b crash -c
    log "cycle ${cycle}: CRASH (vpn pid ${before} -> ${after:-none})"
    sleep 3 # let debuggerd finish the tombstone and the app rebind the service.
  fi
  echo "${cycle},${before},${after},${crashed},${signal_lines},\"$(tr -d '\r\n' < "${run_dir}/client_${cycle}.txt")\"" >> "${csv}"
  (( cycle % 10 == 0 )) && log "cycle ${cycle}/${cycles}: ${crashes} crashes so far"
done

"${ADB}" logcat -d > "${run_dir}/logcat_full.txt" 2>/dev/null
for t in $("${ADB}" shell su 0 ls /data/tombstones 2>/dev/null | tr -d '\r' | grep -v '\.pb$'); do
  "${ADB}" shell su 0 cat "/data/tombstones/${t}" > "${run_dir}/tombstones/${t}.txt"
done
{
  echo "label: ${label}"
  echo "build: $(installed_version)"
  echo "cycles: ${cycles}  connections per cycle: ${conns}"
  echo "cycles with a :vpn crash: ${crashes}"
  echo "tombstones for ${PACKAGE}: $(grep -l "${PACKAGE}" "${run_dir}"/tombstones/* 2>/dev/null | wc -l | tr -d ' ')"
} | tee "${run_dir}/summary.txt"
