#!/bin/bash
# Dump the actual VPN NetworkAgentInfo for Outline (if any) along with the routing
# table for tun0. Used to distinguish "system network still up" from "state.sh
# detection is wrong".

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"

echo "=== NetworkAgentInfo lines mentioning $PKG ==="
"$ADB" shell dumpsys connectivity 2>&1 \
  | grep -F "$PKG" \
  | head -5 | sed 's/^/  /'

echo
echo "=== tun* interfaces in 'ip addr' ==="
"$ADB" shell ip addr 2>&1 | grep -B1 -A4 "^[0-9]*: tun" | sed 's/^/  /' | head -20

echo
echo "=== default route ==="
"$ADB" shell ip route 2>&1 | grep -E "^default|^10\.111|^tun" | sed 's/^/  /'
