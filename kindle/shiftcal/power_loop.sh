#!/bin/sh
# Kitchen Hub power loop: wake -> (sync in background) -> awake window -> standby screenshot -> deep sleep
#
# 10.5
#   * The page is never started while it is already running or still loading. 10.4 sent a second
#     "start app" a few seconds after the launcher's, on every wake - the likely cause of the Kindle's
#     "The application could not be started" box. Page checks and starts live in hub_common.sh.
#   * One way to restart the hub (relaunch). A background job that needs a restart (an installed update)
#     leaves a note (.relaunch) and the loop restarts itself cleanly, instead of a second launcher racing
#     the loop's own cleanup.
#   * hub_update.sh install returns 2 for "nothing installed", so "up to date" no longer restarts the hub.
#   * The last request id is kept across restarts (.last_rid): a tap the page re-sends after a restart is
#     not run twice.
#   * A sync that overruns is stopped with everything it started (curl, sync_data.sh), and Wi-Fi goes off.
#   * The page closing over and over (3 times in 15 minutes) stops the hub instead of reopening it forever.
#   * FREEZE_POWERD=0 in eco.conf turns off pausing powerd during sleep (for testing the wake freeze).
#
# v9.2 fixes
#   * Button wake: an early wake from suspend (rc=0, well before the alarm) is treated as YOU pressing
#     the power button. The hub now stays awake for the full window (min 2 min) instead of
#     re-suspending 3 seconds later, which is what v8.5/v9 did.
#   * The awake window is wall-clock based (deadline), not "loop passes". Any touch on the page
#     resets the deadline to now + WAKE_WINDOW.
#   * Sync runs in the background so touches and Settings saves are still heard while Wi-Fi works.
#   * Single instance: a loop that is no longer the owner of .loop.pid exits instead of fighting.
#   * Battery history (.batt_hist -> mesquite/battery.js), hours-left from the current discharge run,
#     charging flag, and the last 40 log lines exported to mesquite/syslog.js for the Settings > Log tab.
#
# Test hooks (all optional; defaults are the real Kindle paths):
#   HUB_DIR, HUB_SYS_POWER_STATE, HUB_RTC_CANDIDATES, HUB_SUSPEND_CMD, HUB_SS_DIR, HUB_TEST=1
VERSION="10.5"
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
MESQ="$DIR/mesquite"
STATE_JS="$MESQ/state.js"
BATT_JS="$MESQ/battery.js"
LOG_JS="$MESQ/syslog.js"
CONF="$DIR/eco.conf"
MODE="${1:-eco}"
LOG="$DIR/power.log"
PIDF="$DIR/.loop.pid"
MESQ_PIDF="$DIR/.mesquite.pid"
SS_CAP_FILE="$DIR/.capture.png"
SS_DIR="${HUB_SS_DIR:-/usr/share/blanket/screensaver}"
SS_BACKUP="/mnt/us/hub/backup/screensaver"
BATT_HIST="$DIR/.batt_hist"
LAST_SYNC_F="$DIR/.last_sync"
STOCKS_CONF="$DIR/stocks.conf"
STOCKS_JS="$MESQ/stocks.js"
LAST_RID=0
SYS_POWER_STATE="${HUB_SYS_POWER_STATE:-/sys/power/state}"
RTC_CANDIDATES="${HUB_RTC_CANDIDATES:-/sys/class/rtc/rtc1/wakealarm /sys/class/rtc/rtc0/wakealarm}"
WAKE_REASON_F="/sys/kernel/wakeup_reasons/last_resume_reason"
MIN_WINDOW=${HUB_MIN_WINDOW:-120}       # test hook; the real minimum is 2 minutes
export TZ="PCT7"

[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 60000 ] && tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
log() { echo "$(date '+%m-%d %H:%M:%S') [$MODE] $*" >> "$LOG"; }
HC_WHO=$MODE
. "$DIR/hub_common.sh"

load_conf() {
    INTERVAL_MIN=60
    SYNC_EVERY_MIN=60
    WAKE_WINDOW=120
    WIFI_TIMEOUT=40
    MIN_BATT=8
    SCREENSAVER_MODE=""
    SET_SCREENSAVER=""
    PILLOW_DISABLE=2
    CLOUD_ON_WAKE=1
    PHONE_ALERTS=1
    USE_CLOUD_DATA=1
    FREEZE_POWERD=1                    # 10.5: 0 = let powerd run while the Kindle sleeps (test for the wake freeze)
    AUTO_UPDATE=1                      # 0 = only when you tap, 1 = check nightly and tell you (10.5 default), 2 = install at night (undone by itself if it fails)
    [ -f "$CONF" ] && . "$CONF"
    case "$AUTO_UPDATE" in 0|1|2) ;; *) AUTO_UPDATE=1 ;; esac
    case "$FREEZE_POWERD" in 0|1) ;; *) FREEZE_POWERD=1 ;; esac
    case "$USE_CLOUD_DATA" in 0|1) ;; *) USE_CLOUD_DATA=1 ;; esac
    case "$PHONE_ALERTS" in 0|1) ;; *) PHONE_ALERTS=1 ;; esac
    case "$CLOUD_ON_WAKE" in 0|1) ;; *) CLOUD_ON_WAKE=1 ;; esac
    # v8/v9 configs only had SET_SCREENSAVER=0/1
    if [ -z "$SCREENSAVER_MODE" ]; then
        [ "$SET_SCREENSAVER" = "0" ] && SCREENSAVER_MODE=off || SCREENSAVER_MODE=eips
    fi
    case "$SCREENSAVER_MODE" in eips|eips_slots|off) ;; *) SCREENSAVER_MODE=eips ;; esac
    case "$INTERVAL_MIN" in ''|*[!0-9]*) INTERVAL_MIN=60 ;; esac
    [ "$INTERVAL_MIN" -lt 5 ] && INTERVAL_MIN=5
    case "$WAKE_WINDOW" in ''|*[!0-9]*) WAKE_WINDOW=120 ;; esac
    # you asked for at least 2 minutes every time it wakes
    [ "$WAKE_WINDOW" -lt "$MIN_WINDOW" ] && WAKE_WINDOW=$MIN_WINDOW
    case "$SYNC_EVERY_MIN" in ''|*[!0-9]*) SYNC_EVERY_MIN=$INTERVAL_MIN ;; esac
}

save_conf() {
    cat > "$CONF.tmp" <<EOT
INTERVAL_MIN=$INTERVAL_MIN
SYNC_EVERY_MIN=$SYNC_EVERY_MIN
WAKE_WINDOW=$WAKE_WINDOW
WIFI_TIMEOUT=$WIFI_TIMEOUT
MIN_BATT=$MIN_BATT
SCREENSAVER_MODE=$SCREENSAVER_MODE
PILLOW_DISABLE=$PILLOW_DISABLE
CLOUD_ON_WAKE=$CLOUD_ON_WAKE
PHONE_ALERTS=$PHONE_ALERTS
USE_CLOUD_DATA=$USE_CLOUD_DATA
AUTO_UPDATE=$AUTO_UPDATE
FREEZE_POWERD=$FREEZE_POWERD
EOT
    mv "$CONF.tmp" "$CONF"
}

battery_pct() {
    LVL=$(lipc-get-prop com.lab126.powerd battLevel 2>/dev/null | tr -cd '0-9')
    [ -n "$LVL" ] && { echo "$LVL"; return; }
    for f in /sys/class/power_supply/*/capacity; do
        [ -r "$f" ] || continue
        case "$f" in *usb*|*ac*|*charger*) continue ;; esac
        cat "$f" 2>/dev/null; return
    done
}
is_charging() {
    C=$(lipc-get-prop com.lab126.powerd isCharging 2>/dev/null | tr -cd '0-9')
    [ "$C" = "1" ] && { echo 1; return; }
    echo 0
}

# Battery history: one "epoch pct charging" line per wake. Hours-left uses only the current
# discharge run (stops at the last charge or the last time the percentage went up).
BATT_RATE=0
BATT_HOURS_LEFT=0
CHARGING=0
record_battery() {
    PCT="$1"; CHARGING="$2"
    [ -z "$PCT" ] && return
    NOW=$(date +%s)
    echo "$NOW $PCT $CHARGING" >> "$BATT_HIST"
    tail -n 400 "$BATT_HIST" > "$BATT_HIST.tmp" 2>/dev/null && mv "$BATT_HIST.tmp" "$BATT_HIST"   # 9.8: about a week
    RES=$(awk '
        { t[NR]=$1; p[NR]=$2; c[NR]=$3 }
        END {
            n=NR; if (n < 2 || c[n] == 1) { print "0 0"; exit }
            s=n
            for (i=n; i>1; i--) { if (c[i-1] == 1 || p[i-1] < p[i]) break; s=i-1 }
            dt=t[n]-t[s]; dp=p[s]-p[n]
            if (dt >= 1800 && dp >= 1) { r=dp*3600/dt; printf "%.2f %.1f\n", r, p[n]/r } else print "0 0"
        }' "$BATT_HIST" 2>/dev/null)
    BATT_RATE=$(echo "$RES" | awk '{print $1+0}')
    BATT_HOURS_LEFT=$(echo "$RES" | awk '{print $2+0}')
    # 9.8: drain over the whole week (every discharging stretch, charging left out) -> steadier prediction
    W7=$(awk -v now="$NOW" '
        { t[NR]=$1; p[NR]=$2; c[NR]=$3 }
        END {
            dt=0; dp=0; w=0
            for (i=2; i<=NR; i++) {
                if (now - t[i] > 7*86400) continue
                w++
                if (c[i] == 1 || c[i-1] == 1 || p[i] > p[i-1]) continue
                g=t[i]-t[i-1]; if (g <= 0 || g > 6*3600) continue
                dt+=g; dp+=p[i-1]-p[i]
            }
            span=(NR>1 ? t[NR]-t[1] : 0); if (span > 7*86400) span=7*86400
            wpd=(span > 3600 ? w*86400/span : 0)
            if (dt >= 3*3600 && dp >= 1) printf "%.2f %.0f %.1f\n", dp*3600/dt, dt/3600, wpd; else printf "0 %.0f %.1f\n", dt/3600, wpd
        }' "$BATT_HIST" 2>/dev/null)
    RATE7=$(echo "$W7" | awk '{print $1+0}'); HRS7=$(echo "$W7" | awk '{print $2+0}'); WPD=$(echo "$W7" | awk '{print $3+0}')
    LEFT7=$(awk -v p="$PCT" -v r="$RATE7" 'BEGIN { if (r > 0) printf "%.0f", p / r; else print 0 }')
    # charge reminder: once per discharge, when about a day is left
    if [ "$CHARGING" = "1" ]; then rm -f "$DIR/.charge_reminded"
    elif [ "$LEFT7" -gt 0 ] && [ "$LEFT7" -le "${CHARGE_REMIND_H:-24}" ] && [ ! -f "$DIR/.charge_reminded" ]; then
        touch "$DIR/.charge_reminded"; notify_phone "Kitchen Hub battery ${PCT}% - about ${LEFT7} h left. Time to charge."
    fi
    HIST=$(awk 'BEGIN{ORS=""} {printf "%s[%s,%s,%s]", (NR>1?",":""), $1, $2, ($3==""?0:$3)}' "$BATT_HIST" 2>/dev/null)
    cat > "$BATT_JS.tmp" <<EOT
window.HUB_BATT = { now: $NOW, pct: $PCT, charging: $CHARGING, ratePerHour: $BATT_RATE, hoursLeft: $BATT_HOURS_LEFT, rate7: $RATE7, hours7: $HRS7, left7: $LEFT7, wakesPerDay: $WPD, interval: $INTERVAL_MIN, hist: [$HIST] };
EOT
    mv "$BATT_JS.tmp" "$BATT_JS"
}

write_log_js() {
    tail -n 40 "$LOG" 2>/dev/null | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/^/"/' -e 's/$/",/' > "$LOG_JS.body"
    { echo "window.HUB_LOG = ["; cat "$LOG_JS.body"; echo "\"\"];"; } > "$LOG_JS.tmp"
    mv "$LOG_JS.tmp" "$LOG_JS"
    rm -f "$LOG_JS.body"
}

# "9:00 PM" for an epoch, without relying on busybox date -d (PCT is a fixed UTC-7)
fmt_epoch() {
    L=$(( $1 - 25200 ))
    H=$(( (L / 3600) % 24 )); M=$(( (L / 60) % 60 ))
    AP=AM; [ "$H" -ge 12 ] && AP=PM
    H12=$(( H % 12 )); [ "$H12" -eq 0 ] && H12=12
    printf "%d:%02d %s" "$H12" "$M" "$AP"
}

LAST_SYNC=0
LAST_SYNC_STR="Never"
read_last_sync() {
    [ -f "$LAST_SYNC_F" ] || return
    LS=$(awk '{print $1}' "$LAST_SYNC_F" 2>/dev/null)
    case "$LS" in ''|*[!0-9]*) return ;; esac
    LAST_SYNC=$LS
    LAST_SYNC_STR=$(fmt_epoch "$LS")
}

AWAKE_UNTIL=0
NEXT_WAKE_EPOCH=0
WAKE_REASON="start"
write_ui_state() {
    SLEEPING="${1:-0}"
    NEXT_STR="--:--"
    [ "$SLEEPING" = "1" ] && [ "$NEXT_WAKE_EPOCH" -gt 0 ] && NEXT_STR=$(fmt_epoch "$NEXT_WAKE_EPOCH")
    B_NOW=$(battery_pct)
    case "$SCREENSAVER_MODE" in off) SS_LEGACY=0 ;; eips_slots) SS_LEGACY=2 ;; *) SS_LEGACY=1 ;; esac
    cat > "$STATE_JS.tmp" <<EOT
window.HUB_STATE = {
    v: "$VERSION",
    autoUpd: $AUTO_UPDATE,
    updPending: $([ -f "$DIR/.update/pending" ] && echo 1 || echo 0),
    now: $(date +%s),
    sleeping: $SLEEPING,
    awakeUntil: $AWAKE_UNTIL,
    wakeReason: "$WAKE_REASON",
    lastUpdated: "$LAST_SYNC_STR",
    lastSyncEpoch: $LAST_SYNC,
    nextWake: "$NEXT_STR",
    nextWakeEpoch: $NEXT_WAKE_EPOCH,
    intervalMin: $INTERVAL_MIN,
    wakeWindow: $WAKE_WINDOW,
    setScreensaver: $SS_LEGACY,
    screensaverMode: "$SCREENSAVER_MODE",
    pillowDisabled: $PILLOW_DISABLE,
    battery: "${B_NOW:-?}",
    batteryHoursLeft: $BATT_HOURS_LEFT,
    charging: $CHARGING,
    lastRid: $LAST_RID,
    booted: $([ "$BOOT" = "0" ] && echo 1 || echo 0),
    snoozeUntil: 0
};
EOT
    mv "$STATE_JS.tmp" "$STATE_JS"
}

still_owner() { [ "$(cat "$PIDF" 2>/dev/null)" = "$$" ]; }

app_running() { hub_page_running; }     # 10.5: only the hub's own page counts (hub_common.sh)

# Status bar: 9.2 used "disableEnablePillow", which your log shows ran and changed nothing on 5.19.2.
# 9.3 asks the status bar's own window to hide/show itself instead.
# 9.4.1: on firmware 5.19 the clock/battery bar is its own upstart job, "statusbar" - the one
# Jobman stops. (9.4 stopped "pillow" instead, which left the bar up: if a 9.4 run left pillow
# stopped, it is started again here.) 0 = show, 1 or 2 = hide. Exit / "Show" / reboot bring it back.
BAR_STOPPED=0; BAR_NOJOB=0
job_known() { status "$1" >/dev/null 2>&1; }
job_stopped() { status "$1" 2>/dev/null | grep -q "stop/"; }
apply_pillow() {
    if job_known pillow && job_stopped pillow; then
        start pillow >/dev/null 2>&1; log "status bar: started pillow again (9.4 had stopped it)"; sleep 2
    fi
    case "$PILLOW_DISABLE" in
    1|2)
        if job_known statusbar; then
            if job_stopped statusbar; then BAR_STOPPED=1
            elif stop statusbar >/dev/null 2>&1; then
                [ "$BAR_STOPPED" = "1" ] && log "status bar: statusbar service had come back - stopped again" || log "status bar: statusbar service stopped"
                BAR_STOPPED=1
            else log "status bar: could not stop the statusbar service"; fi
        elif [ "$BAR_NOJOB" = "0" ]; then BAR_NOJOB=1; log "status bar: this firmware has no statusbar service"; fi
        lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.hideMe();"}' 2>/dev/null ;;
    *)
        restore_pillow
        lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.showMe();"}' 2>/dev/null ;;
    esac
}
restore_pillow() {   # (old name kept) bring the bar back if this loop hid it
    if [ "$BAR_STOPPED" = "1" ]; then start statusbar >/dev/null 2>&1; BAR_STOPPED=0; log "status bar: statusbar service started again"; fi
}

# stocks.conf -> mesquite/stocks.js so the Markets editor can show what is configured
write_stocks_js() {
    [ -f "$STOCKS_CONF" ] || return
    L=$(grep -v '^[[:space:]]*#' "$STOCKS_CONF" | grep -v '^[[:space:]]*$' | tr -d '\r' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' |
        awk -F: 'BEGIN{ORS=""} { l=$2; if (l=="") l=$1; printf "%s[\"%s\",\"%s\"]", (NR>1?",":""), $1, l }')
    echo "window.HUB_STOCKS = [$L];" > "$STOCKS_JS.tmp" && mv "$STOCKS_JS.tmp" "$STOCKS_JS"
}
urldecode() { printf '%b' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/+/ /g' -e 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')"; }     # 10.5: a typed backslash stays a backslash

wifi_on() {
    lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null
    T=0
    while [ "$T" -lt "$WIFI_TIMEOUT" ]; do
        [ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" = "CONNECTED" ] && return 0
        sleep 2; T=$((T+2))
    done
    return 1
}
wifi_off() { lipc-set-prop com.lab126.cmd wirelessEnable 0 2>/dev/null; }

# Sync in a background subshell; result lands in .last_sync, which the main loop re-reads.
SYNC_PID=""
LAST_SYNC_TRY=0
start_sync() {   # $1 = "lists": only exchange the lists with the gist (quick)
    if [ "$BOOT" = "1" ]; then BOOT_SYNC=1; [ "$1" = "lists" ] || BOOT_FULL=1; return; fi   # 10.4.1: after the page is up
    [ "$1" = "lists" ] || LAST_SYNC_TRY=$(date +%s)
    (
        # $$ in a subshell is the parent's pid: without this the EXIT trap would run cleanup() here
        trap - EXIT INT TERM
        if wifi_on; then
            if [ "$1" != "lists" ]; then
                USE_CLOUD_DATA=$USE_CLOUD_DATA /bin/sh "$DIR/sync_data.sh"
                NOWS=$(date +%s)
                echo "$NOWS" > "$LAST_SYNC_F"
                log "sync done at $(fmt_epoch "$NOWS")"
            fi
            if cloud_ready; then
                N=0
                while [ "$N" -lt 3 ]; do
                    rm -f "$DIR/.cloud_dirty"
                    sh "$DIR/hub_cloud.sh" sync
                    [ -f "$DIR/.cloud_dirty" ] || break     # an edit arrived mid-sync: go again before Wi-Fi drops
                    N=$((N + 1))
                done
                write_cloud_js                                # 9.8.5: the cloud brain's links (TV, calendar) for the page
                # 10.3: the book cloud - fetch books you put on the Kindle, remove ones you moved back
                { [ -s "$DIR/.books_want" ] || [ -s "$DIR/.books_have" ]; } && sh "$DIR/hub_books.sh"
            fi
        else
            log "wifi did not connect within ${WIFI_TIMEOUT}s"
        fi
        wifi_off
    ) &
    SYNC_PID=$!
}
start_search() {   # a recipe search uses the same one-at-a-time network job as the sync
    (
        trap - EXIT INT TERM
        if wifi_on; then sh "$DIR/sync_data.sh" search "$1"; log "recipe search done"; else log "recipe search: no Wi-Fi"; fi
        wifi_off
    ) &
    SYNC_PID=$!
}
start_web() {     # 10.2: the hub's web reader (same one-at-a-time network job)
    (
        trap - EXIT INT TERM
        if wifi_on; then log "$(sh "$DIR/web_fetch.sh" "$1" "$2")"; else
            printf 'window.HUB_WEB={id:"%s",url:"",final:"",code:0,err:"Wi-Fi did not connect",ts:%s,html:""};\n' "$2" "$(date +%s)" > "$DIR/mesquite/web.js"; log "web: no Wi-Fi"; fi
        wifi_off
    ) &
    SYNC_PID=$!
}
start_job() {     # 9.8.5: update-check | update-install | logup | status  (same one-at-a-time network job)
    if [ "$BOOT" = "1" ]; then echo "$1" > "$DIR/.job_next"; return; fi     # 10.4.1: after the page is up
    (
        trap - EXIT INT TERM
        if wifi_on; then
            case "$1" in
                update-check) sh "$DIR/hub_update.sh" check ;;
                update-install)
                    sh "$DIR/hub_update.sh" install; URC=$?
                    case "$URC" in
                        0) log "update installed - restarting the hub"; echo "update installed" > "$DIR/.relaunch" ;;
                        2) log "update: nothing to install" ;;
                        *) log "update: install failed (see sync.log)" ;;
                    esac ;;
                update-auto)
                    date +%Y-%m-%d > "$DIR/.update_auto_day"
                    sh "$DIR/hub_update.sh" auto
                    [ "$?" = "0" ] && { log "night update installed - restarting the hub"; echo "night update installed" > "$DIR/.relaunch"; } ;;
                logup) sh "$DIR/hub_cloud.sh" log ;;
                status) sh "$DIR/hub_cloud.sh" status ;;
            esac
        else log "$1: no Wi-Fi"; fi
        wifi_off
    ) &
    SYNC_PID=$!
}
sync_running() { [ -n "$SYNC_PID" ] && kill -0 "$SYNC_PID" 2>/dev/null; }

HAVE_NC=0
NC_OUT="${TMPDIR:-/tmp}/kitchenhub_nc.$$"      # 10.5: in RAM, not on the flash storage
command -v nc >/dev/null 2>&1 && HAVE_NC=1
qv() { echo "$QS" | tr '&' '\n' | sed -n "s/^$1=//p" | head -1; }
num_or_empty() { case "$1" in ''|*[!0-9]*) echo "" ;; *) echo "$1" ;; esac; }

# One ~1 s listen for a request from the page. Handles: touch=1, snooze=N (seconds; 1 = 5 min),
# interval=, window=, ss= (0 off, 1 eips, 2 eips+slots), pillow=0/1/2, rotate=1.
poll_settings_http() {
    if [ "$HAVE_NC" != "1" ]; then sleep 1; return; fi
    # 10.5: nc runs in the background with a watchdog. BusyBox nc only gives up on its own when nobody
    # connects; a page that connects and then freezes (Kindle error box) kept the socket open and blocked
    # the loop forever - no standby, no auto-rollback, a Kindle that needed a reboot.
    : > "$NC_OUT"
    printf 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok' | nc -l -p 8765 -w 1 > "$NC_OUT" 2>/dev/null &
    NCP=$!
    ( sleep 5; kill "$NCP" 2>/dev/null ) >/dev/null 2>&1 &
    NCW=$!
    wait "$NCP" 2>/dev/null; NCRC=$?
    kill "$NCW" 2>/dev/null
    if [ "$NCRC" -gt 128 ]; then     # the watchdog had to stop it: log at most once a minute
        NCN=$(( ${NCN:-0} + 1 ))
        [ $(( $(date +%s) - ${NC_LOGGED:-0} )) -ge 60 ] && { log "page connection hung - listener reset (${NCN}x so far)"; NC_LOGGED=$(date +%s); }
    fi
    REQ=$(head -1 "$NC_OUT" 2>/dev/null)
    case "$REQ" in *"/save?"*) ;; *) return ;; esac
    [ "$BOOT" = "1" ] && boot_done
    QS=$(echo "$REQ" | sed -n 's#.* /save?\([^ ]*\) HTTP.*#\1#p')
    NOWQ=$(date +%s)
    CHANGED=0
    # a request id the page repeats on retries: handle each id once, echo it back through state.js
    RID=$(num_or_empty "$(qv rid)")
    if [ -n "$RID" ]; then
        if [ "$RID" = "$LAST_RID" ]; then write_ui_state 0; return; fi
        LAST_RID=$RID; echo "$RID" > "$DIR/.last_rid"
    fi
    if [ "$(qv sync)" = "1" ]; then
        NEWU=$((NOWQ + 90)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
        if sync_running; then log "sync requested (already running)"; else log "sync requested from the hub"; start_sync; fi
    fi
    STK=$(qv stocks)
    if [ -n "$STK" ]; then
        # "SYM~LABEL,SYM~LABEL" url-encoded; keep only safe characters, max 10 lines
        urldecode "$STK" | tr ',' '\n' | tr -cd 'A-Za-z0-9^=./&~\n-' | sed -e 's/~/:/' -e '/^:*$/d' | head -n 10 > "$STOCKS_CONF.tmp"
        if [ -s "$STOCKS_CONF.tmp" ]; then
            { echo "# Markets tile symbols (YAHOO_SYMBOL:LABEL) - edited from Settings > Markets"; cat "$STOCKS_CONF.tmp"; } > "$STOCKS_CONF"
            write_stocks_js
            log "markets list saved: $(tr '\n' ' ' < "$STOCKS_CONF.tmp")"
            NEWU=$((NOWQ + 90)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
            sync_running || start_sync
        fi
        rm -f "$STOCKS_CONF.tmp"
    fi

    ITM=$(qv item)
    if [ -n "$ITM" ]; then
        sh "$DIR/hub_cloud.sh" add "$ITM" 2>/dev/null
        touch "$DIR/.cloud_dirty"
        cloud_ready && CLOUD_DUE=$((NOWQ + 12))             # a quick lists sync shortly after the last edit
        NEWU=$((NOWQ + 90)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
    fi
    if [ "$(qv cloudsync)" = "1" ]; then
        if cloud_ready; then
            NEWU=$((NOWQ + 90)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
            if sync_running; then log "lists sync requested (sync already running)"; else log "lists sync requested from the hub"; start_sync lists; fi
        else log "lists sync requested but cloud.conf is missing"; fi
    fi
    V=$(num_or_empty "$(qv cloudwake)")
    if [ -n "$V" ]; then
        case "$V" in 1) CLOUD_ON_WAKE=1 ;; *) CLOUD_ON_WAKE=0 ;; esac
        CHANGED=1; write_cloud_js
        log "lists on button wake: $CLOUD_ON_WAKE"
    fi
    RQ=$(qv rsearch)
    if [ -n "$RQ" ]; then
        RQ=$(urldecode "$RQ" | tr -cd 'A-Za-z0-9 -' | cut -c1-40)
        NEWU=$((NOWQ + 150)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
        if sync_running; then log "recipe search waits for the running sync"; echo "$RQ" > "$DIR/.rsearch_next"
        else log "recipe search: $RQ"; start_search "$RQ"; fi
    fi
    NWS=$(qv news)
    if [ -n "$NWS" ]; then
        : > "$DIR/news.conf.tmp"
        for K in $(urldecode "$NWS" | tr ',' ' '); do
            case "$K" in
                ckpg) echo "https://ckpgtoday.ca/feed/|CKPG|8" ;;
                cbcbc) echo "https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia|CBC BC|6" ;;
                cbcca) echo "https://www.cbc.ca/webfeed/rss/rss-canada|CBC CANADA|5" ;;
                cbcworld) echo "https://www.cbc.ca/webfeed/rss/rss-world|CBC WORLD|5" ;;
                cbcbiz) echo "https://www.cbc.ca/webfeed/rss/rss-business|CBC BUSINESS|4" ;;
                cbctech) echo "https://www.cbc.ca/webfeed/rss/rss-technology|CBC TECH|4" ;;
            esac >> "$DIR/news.conf.tmp"
        done
        [ -s "$DIR/news.conf.tmp" ] && mv "$DIR/news.conf.tmp" "$DIR/news.conf" && rm -f "$DIR/.due_news_night" && log "news sources: $(cut -d'|' -f2 "$DIR/news.conf" | tr '\n' ' ')"
        sync_running || start_sync
    fi
    JB=$(qv job | tr -cd 'a-z-')
    case "$JB" in
        update-rollback)
            log "rollback asked for from the hub"
            if sh "$DIR/hub_update.sh" rollback; then relaunch "rolled back from the hub"; fi ;;
        update-check|update-install|update-auto|logup|status)
            NEWU=$((NOWQ + 180)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
            if sync_running; then log "$JB waits for the running sync"; echo "$JB" > "$DIR/.job_next"; else log "job: $JB"; start_job "$JB"; fi ;;
    esac
    V=$(num_or_empty "$(qv clouddata)")
    if [ -n "$V" ]; then case "$V" in 1) USE_CLOUD_DATA=1 ;; *) USE_CLOUD_DATA=0 ;; esac; CHANGED=1; write_cloud_js; log "cloud data: $USE_CLOUD_DATA"; fi
    BK=$(qv books)
    if [ -n "$BK" ]; then       # 10.3: which books belong on the Kindle: lines "id<TAB>file name"
        urldecode "$BK" | awk -F'\t' 'NF == 2 && $1 ~ /^[A-Za-z0-9]+$/ && $2 !~ /\// && $2 !~ /^\./ && length($2) < 120 { print $1 "\t" $2 }' > "$DIR/.books_want.tmp"
        if ! cmp -s "$DIR/.books_want.tmp" "$DIR/.books_want"; then mv "$DIR/.books_want.tmp" "$DIR/.books_want"; log "books on the Kindle: $(grep -c . "$DIR/.books_want")"; sync_running || start_sync lists; else rm -f "$DIR/.books_want.tmp"; fi
    fi
    SP=$(qv savepage)
    if [ -n "$SP" ]; then       # 10.3: the web page you're reading -> a text file in the Kindle library
        SPN=$(urldecode "$SP" | tr -cd 'A-Za-z0-9 ._()-' | cut -c1-80)
        [ -n "$SPN" ] && log "$(sh "$DIR/web_fetch.sh" save "$SPN")"
    fi
    WU=$(qv web)
    if [ -n "$WU" ]; then
        WU=$(urldecode "$WU" | tr -d '\r\n"`$\\' | cut -c1-500); WID=$(qv wid | tr -cd 'A-Za-z0-9' | cut -c1-20)
        NEWU=$((NOWQ + 240)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
        case "$WU" in
            q:*|http://*|https://*|[A-Za-z0-9]*.*)
                if sync_running; then log "web page waits for the running sync"; printf '%s\n%s\n' "$WU" "$WID" > "$DIR/.web_next"; else log "web: page asked for"; start_web "$WU" "$WID"; fi ;;
        esac
    fi
    if [ "$(qv kbrowser)" = "1" ]; then log "opening the Kindle's own browser (the hub comes back at the next wake)"; AWAY=1; lipc-set-prop com.lab126.appmgrd start app://com.lab126.browser 2>/dev/null; fi
    HV=$(qv health | tr -cd 'A-Za-z0-9.-')
    # 10.4.1: ANY message from the page proves the new page started. The listener takes one message at a
    # time, and on the Kindle the page's health= message was always lost in the start-up rush, so a page
    # that worked was rolled back as "silent". The version comes from .update/pending, so it always matches.
    if [ -z "$HV" ] && [ -f "$DIR/.update/pending" ]; then HV=$(cut -d' ' -f1 "$DIR/.update/pending" | tr -cd 'A-Za-z0-9.-'); fi
    [ -n "$HV" ] && [ -f "$DIR/.update/pending" ] && sh "$DIR/hub_update.sh" health "$HV" && [ ! -f "$DIR/.update/pending" ] && log "update $HV confirmed by the page"
    V=$(num_or_empty "$(qv autoupd)")
    if [ -n "$V" ]; then case "$V" in 0|1|2) AUTO_UPDATE=$V ;; esac; save_conf; write_ui_state 0; log "auto update: $AUTO_UPDATE"; fi
    DG=$(qv diag)
    [ -n "$DG" ] && log "page: $(urldecode "$DG" | tr -cd 'A-Za-z0-9 :=.,x/-' | cut -c1-160)"
    NTF=$(qv notify)
    if [ -n "$NTF" ]; then notify_phone "$(urldecode "$NTF" | tr -d '\r\n' | cut -c1-200)"; fi
    V=$(num_or_empty "$(qv alerts)")
    if [ -n "$V" ]; then
        case "$V" in 1) PHONE_ALERTS=1 ;; *) PHONE_ALERTS=0 ;; esac
        CHANGED=1; write_cloud_js; log "phone alerts: $PHONE_ALERTS"
    fi
    if [ "$(qv exit)" = "1" ]; then
        log "exit requested from the hub - stopping"
        write_ui_state 0
        stop_and_exit "exit from the hub"
    fi
    VP=$(qv vp | tr -cd '0-9x')
    if [ -n "$VP" ] && [ "$VP" != "$LAST_VP" ]; then LAST_VP=$VP; log "page window ${VP} (screen 1236x1648; less height = the bar's space is still reserved)"; fi
    T_REQ=$(num_or_empty "$(qv touch)")
    if [ -n "$T_REQ" ]; then
        NEWU=$((NOWQ + WAKE_WINDOW))
        [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
    fi
    SNZ=$(num_or_empty "$(qv snooze)")
    if [ -n "$SNZ" ] && [ "$SNZ" != "0" ]; then
        [ "$SNZ" = "1" ] && SNZ=300
        NEWU=$((NOWQ + SNZ))
        [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
        log "staying awake ${SNZ}s (requested from the hub)"
    fi
    V=$(num_or_empty "$(qv interval)"); [ -n "$V" ] && { INTERVAL_MIN=$V; SYNC_EVERY_MIN=$V; CHANGED=1; }
    V=$(num_or_empty "$(qv window)");   [ -n "$V" ] && { WAKE_WINDOW=$V; [ "$WAKE_WINDOW" -lt "$MIN_WINDOW" ] && WAKE_WINDOW=$MIN_WINDOW; CHANGED=1; }
    V=$(num_or_empty "$(qv ss)")
    if [ -n "$V" ]; then
        case "$V" in 0) SCREENSAVER_MODE=off ;; 2) SCREENSAVER_MODE=eips_slots ;; *) SCREENSAVER_MODE=eips ;; esac
        CHANGED=1
    fi
    V=$(num_or_empty "$(qv pillow)")
    if [ -n "$V" ]; then
        case "$V" in 1|2) PILLOW_DISABLE=$V ;; *) PILLOW_DISABLE=0 ;; esac
        [ "$PILLOW_DISABLE" = "0" ] && restore_pillow
        apply_pillow
        CHANGED=1
    fi
    if [ "$(qv rotate)" = "1" ]; then
        CUR_ROT=$(lipc-get-prop com.lab126.winmgr orientationLock 2>/dev/null)
        if [ "$CUR_ROT" = "L" ]; then lipc-set-prop com.lab126.winmgr orientationLock U 2>/dev/null
        else lipc-set-prop com.lab126.winmgr orientationLock L 2>/dev/null; fi
    fi
    if [ "$CHANGED" = "1" ]; then
        save_conf
        log "settings saved: interval=${INTERVAL_MIN}m window=${WAKE_WINDOW}s screenshot=${SCREENSAVER_MODE} hide-statusbar=${PILLOW_DISABLE}"
    fi
    write_ui_state 0
}

# cloud.conf -> mesquite/cloud.js so the page can show the pairing code and sync status
ntfy_topic() {
    T=""; [ -f "$DIR/cloud.conf" ] && T=$(sed -n 's/^NTFY_TOPIC=//p' "$DIR/cloud.conf" | tr -cd 'A-Za-z0-9_-' | head -c 64)
    [ -n "$T" ] && { echo "$T"; return; }
    if [ ! -s "$DIR/.ntfy_topic" ]; then
        R=$(od -An -tx1 -N10 /dev/urandom 2>/dev/null | tr -d ' \n')
        [ -n "$R" ] || R=$(date +%s)$$
        echo "kitchenhub-$R" > "$DIR/.ntfy_topic"
    fi
    cat "$DIR/.ntfy_topic"
}
# a message to your phone (ntfy). Runs in the background; Wi-Fi only stays on if a sync needs it
notify_phone() {
    [ "$PHONE_ALERTS" = "1" ] || return
    TOPIC=$(ntfy_topic)
    (
        trap - EXIT INT TERM
        WAS=$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)
        if wifi_on; then
            C=$(kcurl -s --connect-timeout 8 --max-time 20 -o /dev/null -w '%{http_code}' -H "Title: Kitchen Hub" -H "Tags: alarm_clock" -H "Priority: high" -d "$1" "https://ntfy.sh/$TOPIC" 2>/dev/null)
            log "phone alert sent ($C): $1"
        else log "phone alert: no Wi-Fi"; fi
        [ "$WAS" = "CONNECTED" ] || sync_running || wifi_off
    ) &
}
write_cloud_js() {
    NT=$(ntfy_topic)
    if [ -f "$DIR/cloud.conf" ]; then
        ( GIST_ID=""; GH_TOKEN=""; PAGES_URL=""; PASSPHRASE="Holy"; . "$DIR/cloud.conf"
          Q() { echo "$1" | sed 's/[\\"]//g'; }
          LK() { sed -n "s/^$1=\\([A-Za-z0-9:/._-]*\\)\$/\\1/p" "$DIR/.cloud_links" 2>/dev/null | head -1; }
          CDA=$(cat "$DIR/.cloud_data_at" 2>/dev/null | tr -cd '0-9'); BA=$(LK BRAIN_AT | tr -cd '0-9')
          printf 'window.HUB_CLOUD={pages:"%s",gist:"%s",token:"%s",pass:"%s",wake:%s,ntfy:"%s",alerts:%s,cdata:%s,cdataAt:%s,ics:"%s",ics2:"%s",tv:"%s",cgist:"%s",brainAt:%s};\n' "$(Q "$PAGES_URL")" "$(Q "$GIST_ID")" "$(Q "$GH_TOKEN")" "$(Q "$PASSPHRASE")" "$CLOUD_ON_WAKE" "$NT" "$PHONE_ALERTS" \
              "$USE_CLOUD_DATA" "${CDA:-0}" "$(LK ICS_URL)" "$(LK ICS2_URL)" "$(LK TV_REF)" "$(LK CLOUD_GIST)" "${BA:-0}" > "$MESQ/cloud.js.tmp" && mv "$MESQ/cloud.js.tmp" "$MESQ/cloud.js" )
    else
        printf 'window.HUB_CLOUD={pages:"",gist:"",token:"",pass:"",wake:%s,ntfy:"%s",alerts:%s};\n' "$CLOUD_ON_WAKE" "$NT" "$PHONE_ALERTS" > "$MESQ/cloud.js"
    fi
}
CURL_BIN=/usr/bin/curl; [ -x "$CURL_BIN" ] || CURL_BIN=curl
CURL="$CURL_BIN"; [ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"; command -v kcurl >/dev/null 2>&1 || kcurl() { "$CURL_BIN" "$@"; }     # 10.5: never unchecked when kcurl.sh is missing
cloud_ready() { [ -f "$DIR/cloud.conf" ] && [ -f "$DIR/hub_cloud.sh" ]; }

GOV_SAVED=""
if [ "$HUB_TEST" != "1" ]; then
    lipc-set-prop com.lab126.powerd flIntensity 0 2>/dev/null
    G=/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
    if [ -w "$G" ]; then
        GOV_SAVED=$(cat "$G"); [ -s "$DIR/.gov_saved" ] || echo "$GOV_SAVED" > "$DIR/.gov_saved"     # 10.5: stop_hub.sh can put it back after a KILL
        for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo powersave > "$g" 2>/dev/null; done
    fi
fi

# NB: never name a variable PPID - it is read-only in many shells
freeze_powerd() { [ "$FREEZE_POWERD" = "1" ] || return 0; PD=$(pidof powerd 2>/dev/null); [ -n "$PD" ] && kill -STOP $PD 2>/dev/null; }
thaw_powerd()   { PD=$(pidof powerd 2>/dev/null); [ -n "$PD" ] && kill -CONT $PD 2>/dev/null; }

rtc_path() {
    for p in $RTC_CANDIDATES; do
        [ -w "$p" ] && { echo "$p"; return; }
    done
}

cleanup() {
    thaw_powerd
    [ -n "$NCP" ] && kill "$NCP" 2>/dev/null; rm -f "$NC_OUT"     # 10.5
    [ -n "$SYNC_PID" ] && hc_kill_tree "$SYNC_PID"      # 10.5: the job and everything it started
    if still_owner; then
        # only undo global state if a newer loop has not taken over
        [ -n "$GOV_SAVED" ] && for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
            echo "$GOV_SAVED" > "$g" 2>/dev/null
        done
        for r in $RTC_CANDIDATES; do [ -w "$r" ] && echo 0 > "$r" 2>/dev/null; done
        lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
        wifi_off
        [ "$RELAUNCHING" = "1" ] || restore_pillow     # a relaunch hides the bar again right away
        rm -f "$PIDF" "$DIR/.gov_saved"
    fi
    log "loop stopped (pid $$)"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

# 10.5: the only way the loop restarts the hub. Cleanup runs first (synchronously), then a fresh launcher.
relaunch() {
    log "restarting the hub: $1"
    RELAUNCHING=1; trap - EXIT; cleanup
    rm -f "$DIR/.relaunch"
    setsid /bin/sh "$DIR/run_hub.sh" "$MODE" >/dev/null 2>&1 < /dev/null &
    exit 0
}
# ... and the only way it stops everything and hands the Kindle back
stop_and_exit() {
    log "stopping the hub: $1"
    trap - EXIT; cleanup
    exec /bin/sh "$DIR/stop_hub.sh"
}

paint_eink() { eips -g "$1" >/dev/null 2>&1; }

paint_screensaver_slots() {
    [ -d "$SS_DIR" ] || { log "screensaver dir $SS_DIR missing"; return 1; }
    mkdir -p "$SS_BACKUP" 2>/dev/null
    i=0
    while [ "$i" -le 19 ]; do
        N=$(printf "%02d" "$i")
        [ -f "$SS_BACKUP/bg_ss$N.png" ] || { [ -f "$SS_DIR/bg_ss$N.png" ] && cp "$SS_DIR/bg_ss$N.png" "$SS_BACKUP/bg_ss$N.png"; }
        i=$((i+1))
    done
    if mntroot rw 2>/dev/null; then
        i=0; OK=0
        while [ "$i" -le 19 ]; do
            N=$(printf "%02d" "$i")
            cp "$1" "$SS_DIR/bg_ss$N.png" 2>/dev/null && OK=$((OK+1))
            i=$((i+1))
        done
        mntroot ro 2>/dev/null
        log "screensaver: updated $OK/20 slots (originals backed up in $SS_BACKUP)"
        [ "$OK" -gt 0 ]
    else
        log "screensaver: mntroot rw failed, slots not updated"
        return 1
    fi
}

capture_and_freeze_display() {
    rm -f "$SS_CAP_FILE"
    screenshot -f "$SS_CAP_FILE" >/dev/null 2>&1
    RC=$?
    if [ "$RC" -ne 0 ] || [ ! -f "$SS_CAP_FILE" ]; then log "screenshot failed (rc=$RC)"; return 1; fi
    SIG=$(od -An -tx1 -N4 "$SS_CAP_FILE" 2>/dev/null | tr -d ' ')
    SZ=$(wc -c < "$SS_CAP_FILE" 2>/dev/null)
    if [ "$SIG" != "89504e47" ] || [ -z "$SZ" ] || [ "$SZ" -lt 1000 ]; then
        log "screenshot invalid (header=$SIG size=${SZ}B)"; return 1
    fi
    case "$SCREENSAVER_MODE" in
        eips_slots)
            paint_eink "$SS_CAP_FILE"
            if paint_screensaver_slots "$SS_CAP_FILE"; then log "standby frame ${SZ}B painted + screensaver slots"
            else log "standby frame ${SZ}B painted (screensaver slots skipped)"; fi ;;
        *)          paint_eink "$SS_CAP_FILE"; log "standby frame ${SZ}B painted to E-Ink" ;;
    esac
}

do_suspend() {
    if [ -n "$HUB_SUSPEND_CMD" ]; then sh -c "$HUB_SUSPEND_CMD"; return $?; fi
    echo mem > "$SYS_POWER_STATE" 2>/dev/null
}

# Returns 0 = slept until the alarm, 2 = woke early with rc=0 (power button), 1 = could not suspend
suspend_for() {
    RTC=$(rtc_path)
    [ -z "$RTC" ] && { log "no RTC wake alarm available"; return 1; }
    END_TIME=$(( $(date +%s) + $1 ))
    freeze_powerd
    sleep 1
    ATTEMPTS=0
    RESULT=1
    while [ "$ATTEMPTS" -lt 6 ]; do
        NOW=$(date +%s)
        REM=$((END_TIME - NOW))
        [ "$REM" -le 5 ] && { RESULT=0; break; }
        echo 0 > "$RTC" 2>/dev/null
        echo "$END_TIME" > "$RTC" 2>/dev/null
        GOT=$(cat "$RTC" 2>/dev/null)
        if [ "$GOT" != "$END_TIME" ]; then log "RTC alarm readback mismatch ($GOT != $END_TIME)"; RESULT=1; break; fi
        sync
        T0=$(date +%s)
        do_suspend
        RC=$?
        T1=$(date +%s)
        echo 0 > "$RTC" 2>/dev/null
        SLEPT=$((T1 - T0))
        WR=$(head -n 1 "$WAKE_REASON_F" 2>/dev/null | tr -d '\r' | cut -c1-60)
        if [ "$RC" -eq 0 ] && [ "$SLEPT" -ge $((REM - 10)) ]; then
            log "woke on schedule after ${SLEPT}s${WR:+ (reason: $WR)}$([ "$ATTEMPTS" -gt 0 ] && echo " - suspended on try $((ATTEMPTS + 1))")"
            RESULT=0; break
        fi
        if [ "$RC" -eq 0 ] && [ "$SLEPT" -ge 1 ]; then
            log "woke early after ${SLEPT}s of ${REM}s - treating as power button${WR:+ (reason: $WR)}"
            RESULT=2; break
        fi
        # 9.9: the kernel says no while the screen or Wi-Fi is still finishing up. Back off a little more each
        # time (3 s, then 6 s) and log only the first refusal, so the log stays readable.
        [ "$ATTEMPTS" -eq 0 ] && log "suspend refused (rc=$RC, slept ${SLEPT}s) - retrying with back-off"
        ATTEMPTS=$((ATTEMPTS + 1))
        B=$((3 * ATTEMPTS)); [ "$B" -gt 6 ] && B=6; sleep "$B"
    done
    thaw_powerd
    return $RESULT
}

# Used when real suspend is unavailable/refused and in "always" mode: wait for the next wake time
# while still listening, so a tap on the standby screen wakes the hub. Returns 2 if tapped.
wait_listening() {
    UNTIL=$1
    AWAKE_UNTIL=0
    while [ "$(date +%s)" -lt "$UNTIL" ]; do
        poll_settings_http
        [ "$AWAKE_UNTIL" -gt 0 ] && return 2
        still_owner || exit 0
    done
    return 0
}

kill_stray_nc() {
    for P in $(ps 2>/dev/null | grep '[n]c -l -p 8765' | awk '{print $1}'); do kill "$P" 2>/dev/null; done
}

# ---------------------------------------------------------------- start
echo $$ > "$PIDF"
load_conf
read_last_sync
log "start v$VERSION pid $$ (interval ${INTERVAL_MIN}m, window ${WAKE_WINDOW}s, screenshot=${SCREENSAVER_MODE}, hide-statusbar=${PILLOW_DISABLE}, nc=${HAVE_NC}, battery $(battery_pct)%)"
kill_stray_nc
apply_pillow
write_stocks_js
write_cloud_js
[ -f "$DIR/hub_cloud.sh" ] && sh "$DIR/hub_cloud.sh" js 2>/dev/null

T=0; SEEN=0
while [ "$T" -lt 30 ]; do
    if app_running; then SEEN=1; log "startup: mesquite running after ${T}s"; break; fi
    sleep 3; T=$((T+3))
done
[ "$SEEN" = "0" ] && { echo "the page never opened ($(date '+%m-%d %H:%M'))" > "$DIR/.boot_fail"; stop_and_exit "startup: the page never appeared"; }
LAST_RID=$(cat "$DIR/.last_rid" 2>/dev/null | tr -cd '0-9'); LAST_RID=${LAST_RID:-0}

# 10.4.1: CORE FIRST. Until the page has talked to the loop, no Wi-Fi, syncs, cloud or update jobs run
# (they are remembered and started right after). A page that stays silent for BOOT_WAIT seconds stops
# everything cleanly - a fresh update is undone first - instead of leaving the Kindle locked up.
BOOT=1; BOOT_T0=$(date +%s); BOOT_WAIT=${HUB_BOOT_WAIT:-90}; BOOT_SYNC=0; BOOT_FULL=0
boot_done() {
    BOOT=0; rm -f "$DIR/.boot"
    log "page is up after $(( $(date +%s) - BOOT_T0 ))s - starting syncs and extras"
    if [ "$BOOT_SYNC" = "1" ]; then if [ "$BOOT_FULL" = "1" ]; then start_sync; else start_sync lists; fi; fi
}
boot_failed() {
    log "page never talked to the loop in ${BOOT_WAIT}s - stopping everything"
    echo "the page did not start ($(date '+%m-%d %H:%M'))" > "$DIR/.boot_fail"
    rm -f "$DIR/.boot"
    if [ -f "$DIR/.update/pending" ] && [ -z "$HUB_ROLLED" ]; then
        read -r PNV PPV PAT PW < "$DIR/.update/pending"
        log "update $PNV is fresh - undoing it and launching $PPV"
        if sh "$DIR/hub_update.sh" rollback; then export HUB_ROLLED=1; relaunch "fresh update undone"; fi
    fi
    stop_and_exit "the page never talked to the loop"
}
FIRST=1
while true; do
    still_owner || { log "another loop owns $PIDF - exiting"; exit 0; }
    load_conf
    read_last_sync
    STEP=$((INTERVAL_MIN * 60))

    if ! app_running; then
        # 10.5: reopen the page, but not forever: 3 times in 15 minutes means something is wrong with it
        NOWR=$(date +%s); RTIMES=$(for X in $RTIMES $NOWR; do [ $((NOWR - X)) -lt 900 ] && echo "$X"; done | tr '\n' ' ')
        if [ "$(echo $RTIMES | wc -w)" -gt 3 ]; then
            echo "the page kept closing ($(date '+%m-%d %H:%M'))" > "$DIR/.boot_fail"
            stop_and_exit "the page closed 3 times in 15 minutes"
        fi
        log "the page is not running - opening it"
        hub_start_page 30 || log "the page did not open"
        AWAY=0
    elif [ "$AWAY" = "1" ]; then
        log "back from the Kindle browser - bringing the hub to the front"
        lipc-set-prop com.lab126.appmgrd start "app://$HC_APP" 2>/dev/null; AWAY=0
    fi

    B=$(battery_pct); CHG=$(is_charging)
    record_battery "$B" "$CHG"
    if [ "$CHG" != "1" ] && [ -n "$B" ] && [ "$B" -le "$MIN_BATT" ] 2>/dev/null; then
        stop_and_exit "battery ${B}% <= ${MIN_BATT}% and not charging"
    fi
    apply_pillow
    lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null

    NOW=$(date +%s)
    AWAKE_UNTIL=$((NOW + WAKE_WINDOW))
    NEXT_WAKE_EPOCH=0
    write_ui_state 0
    log "awake (${WAKE_REASON}) for ${WAKE_WINDOW}s, battery ${B}%$( [ "$CHG" = "1" ] && echo ' charging')"

    # sync if due (3 min early-wake tolerance), on first start, but never retry more than every 15 min
    if [ "$FIRST" = "1" ] || [ $((NOW - LAST_SYNC)) -ge $((SYNC_EVERY_MIN * 60 - 180)) ]; then
        if [ $((NOW - LAST_SYNC_TRY)) -ge 900 ] || [ "$FIRST" = "1" ]; then start_sync; fi
    fi
    # woken by hand with no full sync due: still fetch list changes from the phone (quick)
    if ! sync_running && cloud_ready && [ "$CLOUD_ON_WAKE" = "1" ]; then
        case "$WAKE_REASON" in button|touch|start) start_sync lists ;; esac
    fi
    # 10.2: once a day after 2 am, check GitHub for an update (and install it if you chose that)
    if [ "$AUTO_UPDATE" != "0" ] && [ "$(date +%H)" -ge 2 ] && [ "$(cat "$DIR/.update_auto_day" 2>/dev/null)" != "$(date +%Y-%m-%d)" ] && grep -q 'PAGES_URL="*http' "$DIR/cloud.conf" 2>/dev/null; then
        J="update-check"; [ "$AUTO_UPDATE" = "2" ] && [ ! -f "$DIR/.update/pending" ] && J="update-auto"
        [ "$J" = "update-check" ] && date +%Y-%m-%d > "$DIR/.update_auto_day"
        if sync_running; then echo "$J" > "$DIR/.job_next"; else log "job: $J (nightly)"; start_job "$J"; fi
    fi
    CLOUD_DUE=0
    FIRST=0
    write_log_js

    # awake window: wall clock, touches push the deadline out, waits for a running sync
    SEEN_SYNC="$LAST_SYNC"
    while :; do
        NOWW=$(date +%s)
        if [ "$NOWW" -ge "$AWAKE_UNTIL" ]; then
            sync_running || break
            [ $((NOWW - AWAKE_UNTIL)) -gt $((WIFI_TIMEOUT + 90)) ] && { log "sync overran; stopping it and going to standby"; hc_kill_tree "$SYNC_PID"; wifi_off; break; }
        fi
        poll_settings_http
        [ -f "$DIR/.relaunch" ] && ! sync_running && relaunch "$(cat "$DIR/.relaunch" 2>/dev/null)"
        [ "$BOOT" = "1" ] && [ $(( $(date +%s) - BOOT_T0 )) -ge "$BOOT_WAIT" ] && boot_failed
        if [ "$BOOT" != "1" ] && [ -s "$DIR/.job_next" ] && ! sync_running; then J2=$(cat "$DIR/.job_next"); rm -f "$DIR/.job_next"; log "job: $J2"; start_job "$J2"; fi
        if [ -s "$DIR/.web_next" ] && ! sync_running; then W1=$(sed -n 1p "$DIR/.web_next"); W2=$(sed -n 2p "$DIR/.web_next"); rm -f "$DIR/.web_next"; start_web "$W1" "$W2"; fi
        if [ -s "$DIR/.rsearch_next" ] && ! sync_running; then Q2=$(cat "$DIR/.rsearch_next"); rm -f "$DIR/.rsearch_next"; log "recipe search: $Q2"; start_search "$Q2"; fi
        if [ "${CLOUD_DUE:-0}" -gt 0 ] && [ "$(date +%s)" -ge "$CLOUD_DUE" ]; then
            CLOUD_DUE=0
            sync_running || start_sync lists
        fi
        read_last_sync
        if [ "$LAST_SYNC" != "$SEEN_SYNC" ]; then SEEN_SYNC="$LAST_SYNC"; write_ui_state 0; fi
        still_owner || { log "another loop owns $PIDF - exiting"; exit 0; }
    done
    SYNC_PID=""

    # 10.2: a fresh update must hear from the page; after two whole awake windows of silence it is undone
    if [ -f "$DIR/.update/pending" ]; then
        read -r PNV PPV PAT PW < "$DIR/.update/pending"
        PW=$(( ${PW:-0} + 1 ))
        if [ "$PW" -ge 2 ]; then
            log "update $PNV never reported in from the page - rolling back to $PPV"
            if sh "$DIR/hub_update.sh" rollback; then relaunch "update $PNV undone"; fi
        else echo "$PNV $PPV $PAT $PW" > "$DIR/.update/pending"; fi
    fi

    NOW=$(date +%s)
    SECS=$((STEP - (NOW % STEP)))
    [ "$SECS" -lt 60 ] && SECS=$((SECS + STEP))
    NEXT_WAKE_EPOCH=$((NOW + SECS))

    write_ui_state 1
    write_log_js
    sleep 6   # give the page time to draw the standby frame before it is captured

    [ "$SCREENSAVER_MODE" != "off" ] && capture_and_freeze_display

    if [ "$MODE" = "eco" ]; then
        suspend_for $((SECS - 3))
        SR=$?
    else
        SR=1
    fi
    case $SR in
        0) WAKE_REASON="timer" ;;
        2) WAKE_REASON="button" ;;
        *)
            [ "$MODE" = "eco" ] && log "could not suspend - waiting in light sleep until $(fmt_epoch "$NEXT_WAKE_EPOCH")"
            wait_listening "$NEXT_WAKE_EPOCH"
            if [ $? -eq 2 ]; then WAKE_REASON="touch"; else WAKE_REASON="timer"; fi
            ;;
    esac
done
