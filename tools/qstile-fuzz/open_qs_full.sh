#!/bin/bash
# Fully expand the QS panel via a long swipe from the top of the screen — more
# reliable than `cmd statusbar expand-settings` which sometimes only opens the
# compact row.
set -u
ADB="$ANDROID_HOME/platform-tools/adb"

"$ADB" shell cmd statusbar collapse >/dev/null; sleep 0.4
# Two swipes: first opens the compact panel, second expands to full QS.
"$ADB" shell input swipe 540 0 540 2000 300; sleep 0.5
"$ADB" shell input swipe 540 200 540 2200 300; sleep 1.0
