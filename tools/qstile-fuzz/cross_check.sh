#!/bin/bash
# Cross-check state.sh's vpn_network_present detection against the raw dumpsys.
set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"

echo "=== state.sh ==="
bash "$(dirname "${BASH_SOURCE[0]}")/state.sh" | sed 's/^/  /'

echo
echo "=== direct dumpsys grep for the same signature ==="
"$ADB" shell dumpsys connectivity 2>&1 \
  | grep -oF "ni{VPN CONNECTED extra: VPN:$PKG}" \
  | head -5 | sed 's/^/  /'

echo
echo "=== ALL lines mentioning 'extra: VPN:$PKG' (any state) ==="
"$ADB" shell dumpsys connectivity 2>&1 \
  | grep -oE "ni\{VPN [A-Z_]+ extra: VPN:$PKG\}" \
  | head -5 | sed 's/^/  /'

echo
echo "=== ALL NetworkAgentInfo header lines (just network IDs + state) ==="
"$ADB" shell dumpsys connectivity 2>&1 \
  | grep -E "^[[:space:]]+NetworkAgentInfo" \
  | grep -oE "network\{[0-9]+\}|ni\{[A-Z]+ [A-Z_]+" \
  | paste - - \
  | sed 's/^/  /'
