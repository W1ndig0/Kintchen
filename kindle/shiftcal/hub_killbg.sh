#!/bin/sh
# Kitchen Hub: stop every part of the hub (loop, page, listener, syncs, updates, books, web jobs) and repair
# what the loop changes (powerd, wake alarm, CPU governor). 10.5: uses the one stop script, stop_hub.sh.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
export TZ="PCT7"
/bin/sh "$DIR/stop_hub.sh" launch
L=$(grep '\[stop\] stopped:' "$DIR/power.log" 2>/dev/null | tail -1 | cut -c16-)
eips -c >/dev/null 2>&1
eips 1 1 "Kitchen Hub stopped." >/dev/null 2>&1
eips 1 3 "$(echo "$L" | cut -c1-70)" >/dev/null 2>&1
eips 1 5 "Run Kitchen Hub Stats to confirm. Home button to leave." >/dev/null 2>&1
