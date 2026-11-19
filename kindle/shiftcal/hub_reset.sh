#!/bin/sh
# Kitchen Hub reset: one tap to save a snapshot of what the Kindle is doing, then stop every part of the
# hub and give the Kindle back its normal sleep, status bar and home screen. Tap "Kitchen Hub Display"
# afterwards for a clean start. Your settings, lists and the update state are not touched.
#
# The snapshot goes to extensions/shiftcal/diag.txt (readable over USB). It holds the Kindle's own system
# log, which says why the hub page stopped (a crash, out of memory, a script error) - the hub's own logs
# can't see that.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
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
    ps 2>&1 | sed -e 's/Bearer [^ ]*/Bearer ***/g' -e 's/github_pat_[A-Za-z0-9_]*/github_pat_***/g' -e 's/ghp_[A-Za-z0-9]*/ghp_***/g'    # 10.5: never the token
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

# 10.5: one stop path for everything (loop, page, jobs, listener), then the Kindle back to normal
/bin/sh "$DIR/stop_hub.sh"
echo "$(date '+%m-%d %H:%M:%S') [reset] everything stopped - snapshot in diag.txt" >> "$DIR/power.log"
