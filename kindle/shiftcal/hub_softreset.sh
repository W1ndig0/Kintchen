#!/bin/sh
# Kitchen Hub soft reset: save a snapshot, stop the hub and all its background processes, then reboot
# the Kindle. Settings, lists and update state are kept. Use this only when the hub is stuck.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
export TZ="PCT7"
/bin/sh "$DIR/hub_stats.sh" >/dev/null 2>&1
cp "$DIR/stats.txt" "$DIR/last_softreset_stats.txt" 2>/dev/null
echo "$(date '+%m-%d %H:%M:%S') [softreset] requested - snapshot saved, rebooting" >> "$DIR/power.log"
/bin/sh "$DIR/stop_hub.sh" launch >/dev/null 2>&1
sync
eips -c >/dev/null 2>&1
eips 1 1 "Kitchen Hub soft reset: rebooting the Kindle..." >/dev/null 2>&1
sleep 2
reboot
