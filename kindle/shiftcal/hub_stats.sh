#!/bin/sh
# Kitchen Hub task manager: shows memory, storage, load, hub state and the busiest processes on screen.
# Read-only. Writes extensions/shiftcal/stats.txt too. Tap the Kindle home button to leave.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
OUT="$DIR/stats.txt"
export TZ="PCT7"

alive() { [ -f "$1" ] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null && echo "running" || echo "stopped"; }
. "$DIR/hub_common.sh"

{
    echo "KITCHEN HUB STATS  $(date '+%m-%d %H:%M:%S')"
    echo "uptime: $(uptime | sed 's/.*up //; s/,  *load.*//')"
    echo "load:   $(cut -d' ' -f1-3 /proc/loadavg)"
    awk '/MemTotal|MemAvailable|SwapFree/ {printf "%s %d MB\n", $1, $2/1024}' /proc/meminfo
    echo "storage /mnt/us: $(df -h /mnt/us 2>/dev/null | awk 'NR==2 {print $4" free of "$2}')"
    echo "storage /var/local: $(df -h /var/local 2>/dev/null | awk 'NR==2 {print $4" free"}')"
    echo "hub loop: $(alive "$DIR/.loop.pid")   page: $( hub_page_running && echo "running ($(hub_page_pids))" || echo stopped)"
    for P in $(pidof mesquite 2>/dev/null); do echo "  mesquite $P: $(hc_cmdline "$P" | cut -c1-90)"; done      # 10.5: which app each page process is
    PD=$(pidof powerd 2>/dev/null)
    echo "powerd: ${PD:-none} state $(awk '{print $3}' /proc/${PD:-0}/stat 2>/dev/null)  (T = paused by hub)"
    echo "update pending: $(cut -d' ' -f1 "$DIR/.update/pending" 2>/dev/null)"
    echo "--- top processes by memory (RSS)"
    # busybox ps on the Kindle has no memory column, so read VmRSS from /proc (kernel threads have none)
    for D in /proc/[0-9]*; do
        P=${D#/proc/}
        R=$(awk '/^VmRSS:/ {print $2}' "$D/status" 2>/dev/null)
        N=$(awk '/^Name:/ {print $2}' "$D/status" 2>/dev/null)
        [ -n "$R" ] && echo "$R $P $N"
    done | sort -nr | head -15 | awk '{printf "%7d KB  pid %-6s %s\n", $1, $2, $3}'
    # the Kindle's own log: app launches, back-button timeouts and errors from this screen's launch
    echo "--- system log: launches and errors (last 40 matching lines)"
    cat /var/log/messages 2>/dev/null | grep -i -E "appmgr|launcher|hackerdude|savecontext|back button|crash|segfault|killed|out of memory|not be|could not" | tail -n 40
} > "$OUT.tmp" 2>&1
echo "$(date '+%m-%d %H:%M:%S') [stats] written" >> "$DIR/power.log"
mv "$OUT.tmp" "$OUT"

# draw it on the screen, one line per row
eips -c >/dev/null 2>&1
ROW=1
while IFS= read -r LINE; do
    eips 1 $ROW "$(echo "$LINE" | cut -c1-70)" >/dev/null 2>&1
    ROW=$((ROW + 2))
done < "$OUT"
eips 1 $((ROW + 1)) "Tap Kitchen Hub Stats again to refresh. Home button to leave." >/dev/null 2>&1
