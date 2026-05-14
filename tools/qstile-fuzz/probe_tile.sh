#!/bin/bash
# Diagnose what's actually at the supposed tile coordinates: dump the QS panel UI
# tree, print the Outline node bounds, and list every clickable ancestor whose box
# contains the center we've been tapping (159, 1040).

set -u
PKG=org.outline.android.client
ADB="$ANDROID_HOME/platform-tools/adb"
TAP_X=${TAP_X:-159}
TAP_Y=${TAP_Y:-1040}

"$ADB" shell cmd statusbar collapse >/dev/null; sleep 0.3
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 0.4
"$ADB" shell cmd statusbar expand-settings >/dev/null; sleep 0.9

"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null
"$ADB" pull /sdcard/ui.xml /tmp/ui-probe.xml >/dev/null 2>&1

echo "=== Outline tile node ==="
grep -oE 'content-desc="Outline"[^/]*bounds="[^"]+"' /tmp/ui-probe.xml \
  | head -1 | sed 's/^/  /'

echo
echo "=== Clickable boxes that contain ($TAP_X,$TAP_Y) ==="
python3 - <<PY
import re, sys
xml = open('/tmp/ui-probe.xml').read()
x, y = $TAP_X, $TAP_Y
hits = []
for n in re.finditer(
    r'<node[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?clickable="(true|false)"[^>]*?/?>',
    xml):
    x1,y1,x2,y2,clk = int(n.group(1)),int(n.group(2)),int(n.group(3)),int(n.group(4)),n.group(5)
    if x1<=x<=x2 and y1<=y<=y2:
        node = n.group(0)
        cd  = re.search(r'content-desc="([^"]*)"', node)
        txt = re.search(r'text="([^"]*)"', node)
        rid = re.search(r'resource-id="([^"]*)"', node)
        hits.append((clk, x1,y1,x2,y2, cd.group(1) if cd else '',
                     txt.group(1) if txt else '', rid.group(1) if rid else ''))
hits.sort(key=lambda h: (h[3]-h[1])*(h[4]-h[2]))  # smallest box first
for clk, x1,y1,x2,y2, cd, txt, rid in hits:
    print(f"  clickable={clk:5s} [{x1},{y1}][{x2},{y2}]  desc={cd!r}  text={txt!r}  rid={rid!r}")
PY

echo
"$ADB" shell screencap -p /sdcard/s.png >/dev/null
"$ADB" pull /sdcard/s.png /tmp/fuzz-probe-tile.png >/dev/null 2>&1
echo "  screenshot saved to /tmp/fuzz-probe-tile.png"
"$ADB" shell cmd statusbar collapse >/dev/null
