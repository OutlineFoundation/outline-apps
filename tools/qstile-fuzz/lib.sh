# shellcheck shell=bash
# Helpers for QS tile fuzz harness. `bash -c 'source tools/qstile-fuzz/lib.sh && ...'`
# (not for zsh — uses bash function syntax).

PKG=org.outline.android.client
TILE_COMPONENT=org.outline.vpn.QuickSettingsTileService
ADB="$ANDROID_HOME/platform-tools/adb"

# 1080x2400 emulator, two-server home screen.
# CONNECT/DISCONNECT button centers measured from uiautomator dump (resource-id="button").
SERVER1_BTN_X=885;  SERVER1_BTN_Y=531
SERVER2_BTN_X=885;  SERVER2_BTN_Y=896
# Outline QS tile bounds [42,946][276,1135] from uiautomator dump of expanded panel.
TILE_X=159;         TILE_Y=1040

focus_app()             { "$ADB" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1; sleep 1.5; }
tap_s1()                { "$ADB" shell input tap $SERVER1_BTN_X $SERVER1_BTN_Y; }
tap_s2()                { "$ADB" shell input tap $SERVER2_BTN_X $SERVER2_BTN_Y; }
open_qs()               { "$ADB" shell cmd statusbar expand-settings; sleep 0.4; "$ADB" shell cmd statusbar expand-settings; sleep 0.5; }
close_qs()              { "$ADB" shell cmd statusbar collapse; sleep 0.3; }
tap_tile_in_open_qs()   { "$ADB" shell input tap $TILE_X $TILE_Y; sleep 0.6; }
tap_tile()              { open_qs; tap_tile_in_open_qs; close_qs; }
screen()                { "$ADB" shell screencap -p /sdcard/s.png >/dev/null; "$ADB" pull /sdcard/s.png "/tmp/fuzz-$1.png" >/dev/null 2>&1; echo "  /tmp/fuzz-$1.png"; }

state() {
  bash "$(dirname "${BASH_SOURCE[0]}")/state.sh" | sed 's/^/  /'
}

# Wait until VPN network appears (true) or disappears (false), up to timeout_s seconds.
wait_for_vpn() {
  local want=$1 timeout=${2:-15}
  for _ in $(seq 1 "$timeout"); do
    local cur
    cur=$(bash "$(dirname "${BASH_SOURCE[0]}")/state.sh" | grep -oE 'vpn_network_present=(true|false)' | cut -d= -f2)
    if [ "$cur" = "$want" ]; then return 0; fi
    sleep 1
  done
  return 1
}

step() { echo; echo "=== $* ==="; }
