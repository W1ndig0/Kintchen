#!/bin/sh
# Kitchen Hub launcher (10.5).  Usage: run_hub.sh [eco|always]
#
# 10.5: only one launcher runs at a time (two taps used to start two launchers that fought each other);
# everything left over is stopped by stop_hub.sh (the one stop path); Windows line endings are fixed
# instead of blocking the launch; the page is started exactly once, through hub_start_page
# (hub_common.sh), with no second "direct" mesquite behind the app manager's back.
#
# 10.4.1: a launch in two stages, with a loading bar on the Kindle screen.
#   1. Launch checks. Everything left over from an earlier run is stopped first, then the Kindle and the
#      hub files are checked. If ANY check fails, nothing is started: the screen says which check failed
#      and why, and the Kindle goes back to Home. (A fresh update that fails a file check is undone and
#      the launch is tried once more.)
#   2. Core first. The page and the hub loop start with syncs, cloud and update jobs held back. They start
#      only after the page has talked to the loop. A page that stays silent for 90 s stops everything
#      cleanly (power_loop.sh) instead of leaving the Kindle locked up.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
CONF="$DIR/eco.conf"
MODE="${1:-eco}"; case "$MODE" in eco|always) ;; *) MODE=eco ;; esac
LOG="$DIR/hub.log"
PIDF="$DIR/.loop.pid"
MESQ_PIDF="$DIR/.mesquite.pid"
MESQ_LOG="$DIR/mesquite.log"
export TZ="PCT7"

PILLOW_DISABLE=2
MIN_BATT=8
[ -f "$CONF" ] && . "$CONF"
V=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$DIR/power_loop.sh" 2>/dev/null | head -1)

[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 50000 ] && tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exec >> "$LOG" 2>&1
echo "=== Launching Kitchen Hub v${V:-?} ($MODE) at $(date) ==="
HC_WHO=launch
. "$DIR/hub_common.sh" 2>/dev/null || { echo "hub_common.sh is missing - the hub files are incomplete"; eips 3 12 "Kitchen Hub: hub_common.sh is missing - copy the hub files again" >/dev/null 2>&1; exit 1; }

# one launcher at a time
LOCK="$DIR/.launch.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    OP=$(cat "$LOCK/pid" 2>/dev/null | tr -cd '0-9')
    [ -z "$OP" ] && { sleep 2; OP=$(cat "$LOCK/pid" 2>/dev/null | tr -cd '0-9'); }    # the other launcher may be writing it right now
    if hc_alive "$OP" && [ "$OP" != "$$" ]; then echo "another launch (pid $OP) is already running - this one stops"; exit 0; fi
    rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# ---------------------------------------------------------------- the loading screen
TOTAL=11; STEP=0
NOSCR=0   # 1 once the page owns the screen: nothing is drawn over it
scr() {   # $1 row, $2 text - written over whatever was on that row
    [ "$NOSCR" = "1" ] && return
    T=$(printf '%-62.62s' "$2")
    if command -v eips >/dev/null 2>&1; then eips 3 "$1" "$T" >/dev/null 2>&1
    elif command -v fbink >/dev/null 2>&1; then fbink -q -x 3 -y "$1" "$T" >/dev/null 2>&1; fi
}
bar() {
    F=$((STEP * 40 / TOTAL)); B=""; i=0
    while [ "$i" -lt 40 ]; do if [ "$i" -lt "$F" ]; then B="$B#"; else B="$B-"; fi; i=$((i + 1)); done
    scr 9 "[$B] $((STEP * 100 / TOTAL))%"
}
check() {   # $1 what is being checked - shown, logged, and the bar moves on
    STEP=$((STEP + 1)); CUR="$1"
    scr $((11 + STEP)) "..  $1"; bar
    echo "check $STEP/$TOTAL: $1"
}
pass() { scr $((11 + STEP)) "ok  $CUR${1:+ - $1}"; echo "   ok${1:+ - $1}"; }

go_home() { lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home 2>/dev/null; }
show_bar_again() {
    status statusbar 2>/dev/null | grep -q "stop/" && start statusbar >/dev/null 2>&1
    lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.showMe();"}' 2>/dev/null
}
fail() {    # $1 why. Nothing has been started; leave the Kindle as a normal Kindle.
    NOSCR=0
    scr $((11 + STEP)) "XX  $CUR - FAILED"
    scr 26 "$1"
    echo "   FAILED: $1"
    echo "$(date '+%m-%d %H:%M:%S') [launch] check '$CUR' failed: $1 - nothing started" >> "$DIR/power.log"
    # a fresh update that broke the hub's own files is undone, then the launch is tried once more
    if [ "$CAN_ROLL" = "1" ] && [ -f "$DIR/.update/pending" ] && [ -z "$HUB_ROLLED" ]; then
        scr 28 "This is a fresh update: undoing it and trying again..."
        if /bin/sh "$DIR/hub_update.sh" rollback; then
            echo "rolled back the fresh update - launching again"
            sleep 3; HUB_ROLLED=1 exec /bin/sh "$DIR/run_hub.sh" "$MODE"
        fi
        scr 29 "Undoing the update did not work."
    fi
    lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
    show_bar_again
    scr 28 "Nothing was started. Tap Kitchen Hub Display to try again."
    scr 29 "Back to Home in 20 seconds."
    sleep 20; go_home; exit 1
}

if command -v eips >/dev/null 2>&1; then eips -c >/dev/null 2>&1; sleep 1; fi
scr 4 "KITCHEN HUB ${V:-}"
scr 6 "Launch checks"
[ -f "$DIR/.boot_fail" ] && { scr 7 "Last time: $(head -c 50 "$DIR/.boot_fail")"; rm -f "$DIR/.boot_fail"; }
bar

# 1 ------------------------------------------------ stop everything from an earlier run
check "Stopping anything left running"
/bin/sh "$DIR/stop_hub.sh" launch
sleep 1
[ -n "$(hc_pids_matching power_loop.sh)" ] && fail "an old hub loop would not stop - restart the Kindle"
hub_page_running && fail "the old hub page would not close - restart the Kindle"
pass

# 2 ------------------------------------------------ battery
check "Battery"
BP=$(lipc-get-prop com.lab126.powerd battLevel 2>/dev/null | tr -cd '0-9')
[ -z "$BP" ] && BP=$(cat /sys/class/power_supply/*/capacity 2>/dev/null | head -1 | tr -cd '0-9')
CH=$(lipc-get-prop com.lab126.powerd isCharging 2>/dev/null | tr -cd '0-9')
if [ -n "$BP" ] && [ "$BP" -le "$MIN_BATT" ] && [ "$CH" != "1" ]; then fail "battery ${BP}% - charge the Kindle first"; fi
pass "${BP:-?}%$( [ "$CH" = "1" ] && echo ' charging')"

# 3 ------------------------------------------------ storage
check "Storage space"
free_mb() { df -k "$1" 2>/dev/null | awk 'NR > 1 { a = $(NF - 2) } END { print int(a / 1024) }'; }
US=$(free_mb /mnt/us); VAR=$(free_mb /var/local); TMPF=$(free_mb /tmp)
[ -n "$US" ] && [ "$US" -lt 20 ] && fail "only ${US} MB free on the Kindle - delete some books"
[ -n "$VAR" ] && [ "$VAR" -lt 2 ] && fail "the Kindle's system storage is full (${VAR} MB) - restart the Kindle"
[ -n "$TMPF" ] && [ "$TMPF" -lt 2 ] && fail "the Kindle's memory disk is full (${TMPF} MB) - restart the Kindle"
pass "${US} MB free"

# 4 ------------------------------------------------ memory
check "Memory"
MA=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null)
[ -z "$MA" ] && MA=$(awk '/^(MemFree|Buffers|Cached):/ { s += $2 } END { print int(s / 1024) }' /proc/meminfo 2>/dev/null)
[ -n "$MA" ] && [ "$MA" -lt 60 ] && fail "only ${MA} MB of memory free - restart the Kindle"
pass "${MA:-?} MB free"

# 5 ------------------------------------------------ hub files (a fresh update can be undone from here on)
CAN_ROLL=1
check "Hub files"
chmod +x "$DIR"/*.sh 2>/dev/null
for F in power_loop.sh hub_common.sh kcurl.sh register_mesquite.sh hub_update.sh stop_hub.sh mesquite/index.html mesquite/config.xml; do
    [ -s "$DIR/$F" ] || fail "$F is missing or empty"
done
# 10.5: a script saved on Windows (CR LF line endings) is fixed here instead of stopping the launch
CR=$(printf '\r')
for F in "$DIR"/*.sh "$DIR"/*.conf; do
    [ -f "$F" ] && grep -q "$CR" "$F" 2>/dev/null || continue
    if tr -d '\r' < "$F" > "$F.lf" 2>/dev/null && [ -s "$F.lf" ] && mv "$F.lf" "$F"; then echo "   fixed Windows line endings in $(basename "$F")"
    else rm -f "$F.lf"; fail "$(basename "$F") has Windows line endings and could not be fixed"; fi
done
pass

# 6 ------------------------------------------------ scripts
check "Scripts"
for F in "$DIR"/*.sh; do
    /bin/sh -n "$F" 2>/dev/null || fail "$(basename "$F") has a mistake in it"
done
pass "$(ls "$DIR"/*.sh | wc -l | tr -d ' ') scripts"

# 7 ------------------------------------------------ the page
check "Hub page"
PG="$DIR/mesquite/index.html"
tail -c 300 "$PG" | grep -qi '</html>' || fail "the page is cut short (an incomplete copy or update)"
PV=$(grep -m 1 '^var VERSION = "' "$PG" | sed 's/^var VERSION = "\([^"]*\)".*/\1/')
[ -n "$V" ] && [ -n "$PV" ] && [ "$PV" != "$V" ] && fail "the page is $PV but the scripts are $V (half-installed)"
pass "${PV:-?}, $(($(wc -c < "$PG") / 1024)) KB"

# 8 ------------------------------------------------ Kindle app registration
CAN_ROLL=0
check "Registering the app"
/bin/sh "$DIR/register_mesquite.sh" || fail "the Kindle's app list could not be updated - restart the Kindle"
pass

# 9 ------------------------------------------------ settings port
check "Settings port"
ps | grep -q '[n]c -l -p 8765' && fail "something is still using the hub's settings port"
pass

# 10 ----------------------------------------------- start the page
check "Starting the page"
scr 24 "All checks passed - opening the hub. Syncs start once it is up."
S0=$STEP; STEP=$TOTAL; bar; STEP=$S0; sleep 1     # 10.5: the bar shows 100%, the step count stays right
NOSCR=1
lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null
# 9.4 stopped the pillow service by mistake: make sure it is running again
status pillow 2>/dev/null | grep -q "stop/" && { echo "starting pillow again (9.4 had stopped it)"; start pillow >/dev/null 2>&1; sleep 2; }
if [ "$PILLOW_DISABLE" != "0" ]; then
    # like Jobman: stop the clock/battery bar BEFORE the hub window opens, so the window gets the space
    echo "hiding the Kindle status bar: $(stop statusbar 2>&1 | head -1)"
    HIDE_BAR=1
fi
echo "boot $(date +%s)" > "$DIR/.boot"
if ! hub_start_page 30; then rm -f "$DIR/.boot"; STEP=10; [ "$HIDE_BAR" = "1" ] && show_bar_again; fail "the Kindle would not open the page"; fi
echo "mesquite active, pid=$(cat "$MESQ_PIDF" 2>/dev/null)"
if [ "$HIDE_BAR" = "1" ]; then
    lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.hideMe();"}' 2>/dev/null
    status statusbar 2>/dev/null | grep -q "stop/" || { echo "statusbar came back while launching - stopping again"; stop statusbar >/dev/null 2>&1; }
fi
pass

# 11 ----------------------------------------------- start the hub loop (core only until the page talks to it)
check "Starting the hub loop"
setsid /bin/sh -c 'echo $$ > "$1"; exec /bin/sh "$2" "$3"' _ "$PIDF" "$DIR/power_loop.sh" "$MODE" >/dev/null 2>&1 < /dev/null &
sleep 2
LP=$(cat "$PIDF" 2>/dev/null)
if [ -z "$LP" ] || ! kill -0 "$LP" 2>/dev/null; then
    /bin/sh "$DIR/stop_hub.sh" launch
    rm -f "$DIR/.boot"; [ "$HIDE_BAR" = "1" ] && show_bar_again; sleep 1; STEP=11
    fail "the hub loop stopped right after starting (see power.log)"
fi
echo "power_loop active, pid=$LP"
pass
