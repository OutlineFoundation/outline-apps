#!/bin/bash
# One-shot snapshot of Outline VPN + QS tile state on the booted emulator.
# Run as `bash state.sh` from anywhere; requires $ANDROID_HOME.

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"

stored=$("$ADB" shell "run-as $PKG cat shared_prefs/quickSettingsTile.xml 2>/dev/null" \
  | sed -nE 's/.*name="vpnRunning" value="([^"]+)".*/\1/p')
[ -z "$stored" ] && stored="missing"

# Outline VPN network signature — each NetworkAgentInfo line in dumpsys carries
# `ni{VPN CONNECTED extra: VPN:<pkg>}` when our app is the owner. Brittle but reliable.
vpn_net="false"
if "$ADB" shell dumpsys connectivity 2>&1 \
    | grep -F "ni{VPN CONNECTED extra: VPN:$PKG}" >/dev/null; then
  vpn_net="true"
fi

svc_running="false"
if "$ADB" shell "dumpsys activity services $PKG" 2>&1 \
    | grep -q "ServiceRecord.*VpnTunnelService"; then
  svc_running="true"
fi

# Outline foreground/background:
fg=$("$ADB" shell dumpsys activity activities 2>&1 \
  | grep -oE "mResumedActivity:.*" | head -1)
outline_fg="false"
echo "$fg" | grep -q "$PKG" && outline_fg="true"

printf "stored_vpnRunning=%s\nvpn_network_present=%s\nvpn_tunnel_service=%s\noutline_foreground=%s\n" \
  "$stored" "$vpn_net" "$svc_running" "$outline_fg"
