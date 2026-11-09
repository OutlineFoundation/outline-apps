# Results, 2026-11-09

Emulator: `outline-spike` AVD, Android 15 (API 35) `default` arm64 image
(userdebug, rooted), 4 cores, 4 GB. Both APKs were built from the same commit;
`control` uses `master`'s `go.mod`/`go.sum` (eycorsican/go-tun2socks v1.16.11),
`patched` uses the pins in #2942 (OutlineFoundation/go-tun2socks@912c3d7).

| Run | Build | Mode | Cycles | Victims with a stray FIN | `:vpn` crashes at teardown |
| --- | --- | --- | --- | --- | --- |
| `control-run1` | control | mix (`run_cycles.sh 40 120`) | 40 | n/a | 0 |
| `control-race1` | control | race (`run_race.sh 1 3`) | 1 | 3 | 1 |
| `control-race-compare` | control | race (`run_race.sh 5 3`) | 5 | 30 | 3 |
| `patched-race-compare` | patched | race (`run_race.sh 5 3`) | 5 | 0 | 0 |

Notes:

- In the two `*-race-compare` runs the `crashed_at_teardown` column says `hang`
  where the script, at the time, treated "tun0 still present 15s after the stop
  intent" as a hang. That was wrong: logcat shows `Remote device closed
  successfully` about 25ms after the stop intent in every one of those cycles
  (2 of 5 on control, 5 of 5 on patched). Read `hang` in those two files as
  "clean teardown". `run_race.sh` now decides from that log line instead.
- All four control crashes have the same abort and stack:
  `Scudo ERROR: corrupted chunk header` in
  `mem_free <- memp_free <- tcp_free <- tcp_abandon <- tcp_abort <- _cgo_..._Cfunc_tcp_abort`.
  See `*/logcat_crash.txt` and `*/tombstones/`.
- The mix mode never crashed the control build in 4,800 connections, so it was
  not run to completion on the patched build.
