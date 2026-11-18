#!/bin/sh
# Kitchen Hub reset: one tap to save a snapshot of what the Kindle is doing, then stop every part of the
# hub and give the Kindle back its normal sleep, status bar and home screen. Tap "Kitchen Hub Display"
# afterwards for a clean start. Your settings, lists and the update state are not touched.
#
# The snapshot goes to extensions/shiftcal/diag.txt (readable over USB). It holds the Kindle's own system
# log, which says why the hub page stopped (a crash, out of memory, a script error) - the hub's own logs
# can't see that.
DIR="/mnt/us/extensions/shiftcal"
OUT="$DIR/diag.txt"
export TZ="PCT7"

{
    echo "=== Kitchen Hub snapshot $(date) ==="
    echo "--- uptime / memory / storage"
    uptime 2>&1; free 2>&1; df -h /mnt/us /tmp /var/local 2>&1
    echo "--- hub files"
    echo "loop pid file: $(cat "$DIR/.loop.pid" 2>/dev/null)  mesquite pid file: $(cat "$DIR/.mesquite.pid" 2>/dev/null)"
    echo "update pending: $(cat "$DIR/.update/pending" 2>/dev/null)"
    echo "page file: $(ls -l "$DIR/mesquite/index.html" 2>&1)"
    echo "--- processes"
    ps 2>&1
    echo "--- powerd / screen / wifi"
    PD=$(pidof powerd 2>/dev/null); echo "powerd pid: ${PD:-none}  state: $(cat /proc/${PD:-0}/stat 2>/dev/null | awk '{print $3}') (T = stopped by the hub)"
    echo "powerd status: $(lipc-get-prop com.lab126.powerd status 2>&1 | head -3 | tr '\n' ' ')"
    echo "wifi: $(lipc-get-prop com.lab126.wifid cmState 2>&1)  wireless enabled: $(lipc-get-prop com.lab126.cmd wirelessEnable 2>&1)"
    echo "statusbar: $(status statusbar 2>&1)  pillow: $(status pillow 2>&1)"
    echo "--- system log: hub, browser and crash lines"
    if [ -f /var/log/messages ]; then L=/var/log/messages; else L=""; fi
    { [ -n "$L" ] && cat "$L"; logread 2>/dev/null; } | grep -i -E "mesquite|kitchenhub|appmgr|waf|oom|out of memory|killed process|segfault|signal 11|crash|shiftcal|webkit|jsc" | tail -n 150
    echo "--- system log: last 150 lines"
    { [ -n "$L" ] && cat "$L"; logread 2>/dev/null; } | tail -n 150
    echo "--- hub log tails"
    tail -n 30 "$DIR/power.log" 2>&1
    tail -n 15 "$DIR/sync.log" 2>&1
    tail -n 20 "$DIR/mesquite.log" 2>/dev/null
    echo "=== end of snapshot ==="
} > "$OUT.tmp" 2>&1
mv "$OUT.tmp" "$OUT"

# stop the hub loop(s), the page listener, the page, and RTC alarms; thaw powerd; status bar and Wi-Fi back
/bin/sh "$DIR/stop_hub.sh"
# background jobs the loop may have started (syncs, update, web pages, books) - stop_hub.sh leaves these
for S in sync_data.sh hub_cloud.sh hub_update.sh hub_books.sh web_fetch.sh; do
    for P in $(ps | grep "[/]$S" | awk '{print $1}'); do kill "$P" 2>/dev/null; done
done
rm -f "$DIR/.job_next" "$DIR/.web_next" "$DIR/.rsearch_next" /tmp/kitchenhub_nc.* 2>/dev/null
# make sure powerd is running and not stopped (the hub pauses it while the Kindle sleeps)
PD=$(pidof powerd 2>/dev/null); [ -n "$PD" ] && kill -CONT $PD 2>/dev/null
lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home 2>/dev/null
echo "$(date '+%m-%d %H:%M:%S') [reset] everything stopped - snapshot in diag.txt" >> "$DIR/power.log"
