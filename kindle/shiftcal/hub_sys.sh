#!/bin/sh
# Kitchen Hub 10.9: the task manager / hub-mode probe. Looks, never changes anything.
#   CPU use (a 1-second sample), memory, the busiest and biggest processes, the Kindle's system services
#   (upstart jobs) and whether they run, uptime, storage. Writes:
#     mesquite/sys.js   for Settings > System on the hub
#     .sysprobe.txt     plain text; the cloud log carries it, so hub mode can later stop only services
#                       that are proven safe to stop on THIS Kindle
# Run by power_loop.sh on full wakes (at most every 10 min) and when Settings > System is opened.
DIR=${HUB_DIR:-/mnt/us/extensions/shiftcal}
OUT="$DIR/mesquite/sys.js"; TXT="$DIR/.sysprobe.txt"
P=${HUB_PROC:-/proc}
T=$(mktemp -d 2>/dev/null) || { T="/tmp/khsys.$$"; mkdir -p "$T"; }
trap 'rm -rf "$T"' EXIT

# per-process cpu ticks now and 1 s later
snap() { for D in "$P"/[0-9]*; do [ -r "$D/stat" ] && awk -v p="${D##*/}" '{ sub(/^[^)]*\) /, ""); print p, $12 + $13 }' "$D/stat" 2>/dev/null; done; }
head -1 "$P/stat" > "$T/cpu1"; snap > "$T/p1"
sleep 1
head -1 "$P/stat" > "$T/cpu2"; snap > "$T/p2"
CPU=$(cat "$T/cpu1" "$T/cpu2" | awk '{ idle = $5 + $6; tot = 0; for (i = 2; i <= NF; i++) tot += $i; if (NR == 1) { i1 = idle; t1 = tot } else { dt = tot - t1; di = idle - i1; printf "%d %d", (dt > 0 ? (dt - di) * 100 / dt + 0.5 : 0), dt } }')
CPU_PCT=${CPU% *}; JIFF=${CPU#* }

# processes: pid name rss(kB) cpu%  (cpu% of one second of all cores' time)
for D in "$P"/[0-9]*; do
    PID=${D##*/}
    N=$(tr -d '\0' 2>/dev/null < "$D/comm" || sed -n 's/^Name:[[:space:]]*//p' "$D/status" 2>/dev/null)
    [ -n "$N" ] || continue
    R=$(sed -n 's/^VmRSS:[[:space:]]*\([0-9]*\).*/\1/p' "$D/status" 2>/dev/null)
    echo "$PID ${R:-0} $N"
done > "$T/procs"
awk -v j="${JIFF:-100}" 'FILENAME == ARGV[1] { a[$1] = $2; next } { d = $2 - a[$1]; if ($1 in a && d > 0) print $1, d * 100 / (j > 0 ? j : 100) }' "$T/p1" "$T/p2" > "$T/cpuper"
awk 'FILENAME == ARGV[1] { c[$1] = $2; next } { printf "%s\t%s\t%s\t%.1f\n", $1, $3, $2, ($1 in c ? c[$1] : 0) }' "$T/cpuper" "$T/procs" > "$T/table"

# memory (kB)
MEM=$(awk '/^MemTotal:/ { t = $2 } /^MemFree:/ { f = $2 } /^Buffers:/ { b = $2 } /^Cached:/ { c = $2 } /^MemAvailable:/ { a = $2 } END { if (!a) a = f + b + c; printf "%d %d", t, a }' "$P/meminfo" 2>/dev/null)
MEM_T=${MEM% *}; MEM_A=${MEM#* }
UP=$(cut -d' ' -f1 "$P/uptime" 2>/dev/null | cut -d. -f1)
LOAD=$(cut -d' ' -f1-3 "$P/loadavg" 2>/dev/null)
DF=$(df -k /mnt/us 2>/dev/null | awk 'NR == 2 { print $2, $4 }'); [ -n "$DF" ] || DF=$(df -k "$DIR" 2>/dev/null | awk 'NR == 2 { print $2, $4 }')

# the Kindle's services (upstart): "name running|stopped"
: > "$T/svc"
if command -v initctl >/dev/null 2>&1; then
    initctl list 2>/dev/null | awk '{ n = $1; s = ($2 ~ /running/) ? "running" : "stopped"; sub(/,$/, "", n); print n, s }' | sort -u > "$T/svc"
elif [ -d /etc/upstart ]; then
    for F in /etc/upstart/*.conf; do N=$(basename "$F" .conf); status "$N" 2>/dev/null | grep -q running && echo "$N running" || echo "$N stopped"; done > "$T/svc"
fi

# ---- sys.js for the page (names are sanitised: letters, digits, _ . - only) ----
jsn() { tr -cd 'A-Za-z0-9_.:-'; }
{
    printf 'window.HUB_SYS={at:%s,cpu:%s,load:"%s",memTotal:%s,memAvail:%s,uptime:%s,disk:[%s],' \
        "$(date +%s)" "${CPU_PCT:-0}" "$(echo "$LOAD" | tr -cd '0-9. ')" "${MEM_T:-0}" "${MEM_A:-0}" "${UP:-0}" "$(echo "${DF:-0 0}" | tr ' ' ',')"
    printf 'top:['
    sort -t "$(printf '\t')" -k4,4nr -k3,3nr "$T/table" | head -12 | awk -F'\t' '{ gsub(/[^A-Za-z0-9_.:-]/, "", $2); printf "%s[%d,\"%s\",%d,%.1f]", (NR > 1 ? "," : ""), $1, $2, $3, $4 }'
    printf '],svc:['
    awk '{ gsub(/[^A-Za-z0-9_.:-]/, "", $1); printf "%s[\"%s\",%d]", (NR > 1 ? "," : ""), $1, ($2 == "running") }' "$T/svc"
    printf ']};\n'
} > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

# ---- plain text for the cloud log ----
{
    echo "probe $(date '+%Y-%m-%d %H:%M') cpu ${CPU_PCT:-?}% load $LOAD mem ${MEM_A:-?}/${MEM_T:-?} kB free up ${UP:-?}s disk(kB total free) ${DF:-?}"
    echo "-- biggest processes (pid name rss_kB cpu%)"
    sort -t "$(printf '\t')" -k3,3nr "$T/table" | head -25 | tr '\t' ' '
    echo "-- services ($(grep -c running "$T/svc") running of $(grep -c . "$T/svc"))"
    tr '\n' ';' < "$T/svc"; echo
} > "$TXT.tmp" && mv "$TXT.tmp" "$TXT"
exit 0
