#!/bin/bash
# Run every scenario in this directory in order, reporting PASS/FAIL summary at
# the end. Each scenario is responsible for its own reset; we just sequence them.

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

scenarios=(
  "03-cross-source.sh"
  "04-rapid-double-tap-off.sh"
  "05-rapid-double-tap-on.sh"
  "06-server-switch.sh"
  "07-disconnect-during-startup.sh"
)

results=()
for s in "${scenarios[@]}"; do
  echo
  echo "######################################################################"
  echo "# $s"
  echo "######################################################################"
  set +e
  bash "$HERE/$s"
  rc=$?
  set -e
  results+=("$s rc=$rc")
done

echo
echo "######################################################################"
echo "# summary"
echo "######################################################################"
for r in "${results[@]}"; do
  echo "  $r"
done
