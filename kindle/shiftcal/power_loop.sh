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
# 10.6: smart wake schedule (SMART_SLEEP=1). How often the Kindle wakes depends on where you are:
#   home  every HOME_MIN minutes (15)
#   work  every AWAY_MIN minutes (120) - work times come from your shifts: the page sends them as
#         away=START-END,... (epoch seconds, next 7 days) and they are kept in .away
#   night every NIGHT_MIN minutes (180) between NIGHT_FROM and NIGHT_TO o'clock (23 - 6)
# When a work shift or the night ends, the Kindle wakes right then, so it speeds up as soon as you're home.
# A full sync still happens at most every SYNC_EVERY_MIN minutes (60); in between, a wake only refreshes
# the screen. SMART_SLEEP=0 is the old fixed INTERVAL_MIN.
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
VERSION="10.10"
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
    SMART_SLEEP=1; HOME_MIN=15; AWAY_MIN=120; NIGHT_MIN=180; NIGHT_FROM=23; NIGHT_TO=6     # 10.6
    FREEZE_POWERD=1                    # 10.5: 0 = let powerd run while the Kindle sleeps (test for the wake freeze)
    LOCAL_ONLY=0                       # 10.9: 1 = the settings port listens on 127.0.0.1 only (needs an nc with -s; test first)
    QUICK_WAKE=1                       # 10.9: timer wakes refresh the standby page and sleep again (button = full hub); 0 = old way
    CLOCK_MODE=15                      # 10.9: standby clock: 15 = exact at each wake (:00 :15 :30 :45), min = new minute every minute
    LIGHT_AWAKE=keep                   # 10.9.2: keep = the hub never touches the frontlight (as before 10.9);
                                       #         0-24 = this light while awake, off while it sleeps
    # 10.10: sleep, sync and battery settings (Settings > Sleep). See UPDATE_10.10.txt.
    SLEEP_CLOCK=min                    # standby clock: min = every minute (time only), 15 = every 15 min, hour, off
    NIGHT_CLOCK=same                   # at night (NIGHT_FROM-NIGHT_TO): same = like the day, hour = the hour only, off
    NIGHT_DEGHOST=1                    # a full (flashing) redraw each hour at night clears e-ink ghosting from the ticks
    HOURLY_REFRESH=1                   # the standby page is redrawn on the hour (news, countdowns, new day)
    WX_ANIM=1                          # ~10 s weather animation + bird of the hour on the hourly redraw
    TIMER_TICK=0                       # 1 = a running kitchen timer counts down on the standby screen every minute
    SYNC_MODE=manual                   # cloud data: manual (SYNC only) or every 2 / 6 / 12 hours
    EDIT_PUSH=now                      # Kindle edits to the cloud: now (short Wi-Fi burst) or sync (with the next sync)
    LISTS_ON_WAKE=0                    # 1 = fetch phone list changes on every button press (Wi-Fi each time)
    DAILY_SESSION=1                    # one Wi-Fi session a day: clock check, phone commands, new data if any, update check, report
    DAILY_HOUR=3
    LOWBATT_SAVER=1                    # below 15%: clock every 15 min, no animation
    CLOCK_DRAW=auto                    # auto = the loop draws the digits when the Kindle can; page = the page redraws the minute
    AUTO_UPDATE=1                      # 0 = only when you tap, 1 = check nightly and tell you (10.5 default), 2 = install at night (undone by itselfif it fails)
    [ -f "$CONF" ] && . "$CONF"
    case "$AUTO_UPDATE" in 0|1|2) ;; *) AUTO_UPDATE=1 ;; esac
    case "$FREEZE_POWERD" in 0|1) ;; *) FREEZE_POWERD=1 ;; esac
    case "$LOCAL_ONLY" in 0|1) ;; *) LOCAL_ONLY=0 ;; esac
    case "$QUICK_WAKE" in 0|1) ;; *) QUICK_WAKE=1 ;; esac
    case "$CLOCK_MODE" in 15|min) ;; *) CLOCK_MODE=15 ;; esac
    case "$SLEEP_CLOCK" in min|15|hour|off) ;; *) SLEEP_CLOCK=min ;; esac
    case "$NIGHT_CLOCK" in same|hour|off) ;; *) NIGHT_CLOCK=same ;; esac
    case "$SYNC_MODE" in manual|2|6|12) ;; *) SYNC_MODE=manual ;; esac
    case "$EDIT_PUSH" in now|sync) ;; *) EDIT_PUSH=now ;; esac
    case "$CLOCK_DRAW" in auto|page) ;; *) CLOCK_DRAW=auto ;; esac
    for V in NIGHT_DEGHOST HOURLY_REFRESH WX_ANIM DAILY_SESSION LOWBATT_SAVER; do
        eval "case \"\$$V\" in 0|1) ;; *) $V=1 ;; esac"
    done
    case "$TIMER_TICK" in 1) ;; *) TIMER_TICK=0 ;; esac
    case "$LISTS_ON_WAKE" in 1) ;; *) LISTS_ON_WAKE=0 ;; esac
    case "$DAILY_HOUR" in ''|*[!0-9]*) DAILY_HOUR=3 ;; esac; [ "$DAILY_HOUR" -gt 23 ] && DAILY_HOUR=3
    # (10.9 had FRONTLIGHT=0 as its default, which turned the light OFF at every start and wake; that old
    #  setting is ignored, so nobody gets a dark screen they never asked for)
    case "$LIGHT_AWAKE" in keep) ;; ''|*[!0-9]*) LIGHT_AWAKE=keep ;; *) [ "$LIGHT_AWAKE" -gt 24 ] && LIGHT_AWAKE=24 ;; esac
    case "$SMART_SLEEP" in 0|1) ;; *) SMART_SLEEP=1 ;; esac
    case "$HOME_MIN" in ''|*[!0-9]*) HOME_MIN=15 ;; esac;   [ "$HOME_MIN" -lt 5 ] && HOME_MIN=5
    case "$AWAY_MIN" in ''|*[!0-9]*) AWAY_MIN=120 ;; esac;  [ "$AWAY_MIN" -lt 15 ] && AWAY_MIN=15
    case "$NIGHT_MIN" in ''|*[!0-9]*) NIGHT_MIN=180 ;; esac; [ "$NIGHT_MIN" -lt 15 ] && NIGHT_MIN=15
    case "$NIGHT_FROM" in ''|*[!0-9]*) NIGHT_FROM=23 ;; esac; [ "$NIGHT_FROM" -gt 23 ] && NIGHT_FROM=23
    case "$NIGHT_TO" in ''|*[!0-9]*) NIGHT_TO=6 ;; esac;     [ "$NIGHT_TO" -gt 23 ] && NIGHT_TO=6
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
LOCAL_ONLY=$LOCAL_ONLY
SLEEP_CLOCK=$SLEEP_CLOCK
NIGHT_CLOCK=$NIGHT_CLOCK
NIGHT_DEGHOST=$NIGHT_DEGHOST
HOURLY_REFRESH=$HOURLY_REFRESH
WX_ANIM=$WX_ANIM
TIMER_TICK=$TIMER_TICK
SYNC_MODE=$SYNC_MODE
EDIT_PUSH=$EDIT_PUSH
LISTS_ON_WAKE=$LISTS_ON_WAKE
DAILY_SESSION=$DAILY_SESSION
DAILY_HOUR=$DAILY_HOUR
LOWBATT_SAVER=$LOWBATT_SAVER
CLOCK_DRAW=$CLOCK_DRAW
QUICK_WAKE=$QUICK_WAKE
CLOCK_MODE=$CLOCK_MODE
LIGHT_AWAKE=$LIGHT_AWAKE
SMART_SLEEP=$SMART_SLEEP
HOME_MIN=$HOME_MIN
AWAY_MIN=$AWAY_MIN
NIGHT_MIN=$NIGHT_MIN
NIGHT_FROM=$NIGHT_FROM
NIGHT_TO=$NIGHT_TO
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
    WS_NOW=$(date +%s); is_night_at "$WS_NOW" && SMODE=night || SMODE=home
    SC_BY_NOW=page; [ "$SLEEPING" = "1" ] && SC_BY_NOW=$(clock_by)      # 10.10: who draws the standby minute
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
    smart: $SMART_SLEEP, homeMin: $HOME_MIN, awayMin: $AWAY_MIN, nightMin: $NIGHT_MIN, nightFrom: $NIGHT_FROM, nightTo: $NIGHT_TO,
    where: "${SMODE:-fixed}", aways: $(grep -c . "$DIR/.away" 2>/dev/null || echo 0),
    snoozeUntil: 0,
    quick: ${QUICK_NEXT:-0}, quickWake: $QUICK_WAKE, clockMode: "$CLOCK_MODE", frontlight: $([ "$LIGHT_AWAKE" = keep ] && echo -1 || echo "$LIGHT_AWAKE"),
    rate7: ${RATE7:-0}, hours7: ${HRS7:-0}, wakesPerDay: ${WPD:-0},
    sleepClock: "$SLEEP_CLOCK", nightClock: "$NIGHT_CLOCK", nightDeghost: $NIGHT_DEGHOST, hourly: $HOURLY_REFRESH, wxAnim: $WX_ANIM,
    timerTick: $TIMER_TICK, timerEnd: ${TIMER_END:-0}, syncMode: "$SYNC_MODE", editPush: "$EDIT_PUSH", listsOnWake: $LISTS_ON_WAKE,
    daily: $DAILY_SESSION, dailyHour: $DAILY_HOUR, lowSaver: $LOWBATT_SAVER, clockDraw: "$CLOCK_DRAW", clockBy: "$SC_BY_NOW",
    dataN: ${DATA_N:-0}
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

wifi_on() {     # $1 = seconds to wait (default WIFI_TIMEOUT)
    lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null
    T=0; WIFI_T0=$(date +%s); en_add wifi_n
    while [ "$T" -lt "${1:-$WIFI_TIMEOUT}" ]; do
        [ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" = "CONNECTED" ] && return 0
        sleep 2; T=$((T+2))
    done
    return 1
}
wifi_off() {
    lipc-set-prop com.lab126.cmd wirelessEnable 0 2>/dev/null
    if [ -n "$WIFI_T0" ]; then en_add wifi_s $(( $(date +%s) - WIFI_T0 )); WIFI_T0=""; fi
}

# ---------- 10.10: the energy report (one line a day in power.log, mesquite/energy.js for the page, and in the
# log/status the phone reads). Counters live in .energy as "key value" lines for the current day.
EN_F="$DIR/.energy"
en_add() {      # en_add key amount   (safe from the background syncs: one small append, summed when read)
    echo "$1 ${2:-1}" >> "$EN_F" 2>/dev/null
}
en_sum() { awk -v k="$1" '$1 == k { s += $2 } END { print s + 0 }' "$EN_F" 2>/dev/null || echo 0; }
en_day_check() {      # a new day: write yesterday's report, start again
    ED=$(date +%Y-%m-%d)
    [ -f "$EN_F" ] || { echo "day $ED" > "$EN_F"; return; }
    OD=$(sed -n 's/^day //p' "$EN_F" | head -1)
    [ "$OD" = "$ED" ] && return
    en_report "$OD"
    echo "day $ED" > "$EN_F"
    echo "$(battery_pct)" > "$DIR/.energy_b0"
}
en_report() {     # $1 = the day the counters belong to
    awk -v day="${1:-today}" -v b0="$(cat "$DIR/.energy_b0" 2>/dev/null)" -v b1="$(battery_pct)" -v rate="${RATE7:-0}" -v left="$(awk -v h="${HRS7:-0}" 'BEGIN { printf "%.1f", h / 24 }')" '
        $1 != "day" { s[$1] += $2 }
        END {
            ta = s["tick_cs"] / 100; tn = s["ticks"] + 0; avg = tn ? ta / tn : 0
            bat = "battery " (b0 == "" ? "?" : b0) "%->" (b1 == "" ? "?" : b1) "%"
            if (b0 != "" && b1 != "" && b0 + 0 > b1 + 0) bat = bat " (" (b0 - b1) "% used"; else if (b0 != "" && b1 != "" && b1 + 0 > b0 + 0) bat = bat " (charged"; else bat = bat " ("
            if (rate + 0 > 0 && left + 0 > 0) bat = bat (bat ~ /\($/ ? "" : ", ") sprintf("7-day %.2f%%/h, ~%.1f days left", rate, left)
            bat = bat ")"; sub(/ \(\)$/, "", bat)
            printf "energy %s: %s | %d button wakes (%d min awake) | %d hourly redraws | %d clock ticks (avg %.1f s, %d slow) | Wi-Fi %d times, %.1f min | %d syncs, %d edit bursts, %d daily\n",
                day, bat, s["wake_btn"], s["awake_s"] / 60, s["hourly"], tn, avg, s["slow"], s["wifi_n"], s["wifi_s"] / 60, s["syncs"], s["bursts"], s["daily"]
        }' "$EN_F" > "$DIR/.energy_last" 2>/dev/null
    [ -s "$DIR/.energy_last" ] || return
    log "$(cat "$DIR/.energy_last")"
    { printf 'window.HUB_ENERGY = {line: "'; tr -d '"\\\n' < "$DIR/.energy_last"; printf '", at: %s};\n' "$(date +%s)"; } > "$MESQ/energy.js.tmp" && mv "$MESQ/energy.js.tmp" "$MESQ/energy.js"
}
# seconds since boot with hundredths, from the kernel (no program started): for timing the clock ticks
uptime_cs() { read -r UP_A UP_B < /proc/uptime 2>/dev/null; UP_A=${UP_A:-0}; case "$UP_A" in *.*) echo "${UP_A%.*}${UP_A#*.}" ;; *) echo "${UP_A}00" ;; esac; }

# ---------- 10.10: the Kindle's clock, checked against a web server's time in the daily session (Wi-Fi is
# rarely on now, and a minute-accurate standby clock shows drift). Only fixes 20 s - 1 day differences.
clock_check() {
    HD=$(kcurl -sI --connect-timeout 6 --max-time 10 https://api.github.com 2>/dev/null | tr -d '\r' | sed -n 's/^[Dd]ate: *//p' | head -1)
    [ -n "$HD" ] || { log "clock check: no time from the server"; return; }
    SE=$(date -u -D '%a, %d %b %Y %H:%M:%S' -d "${HD% GMT}" +%s 2>/dev/null)
    case "$SE" in ''|*[!0-9]*) log "clock check: could not read \"$HD\""; return ;; esac
    LE=$(date +%s); DF=$((SE - LE)); AD=${DF#-}
    if [ "$AD" -ge 20 ] && [ "$AD" -lt 86400 ]; then
        if [ "$HUB_TEST" != "1" ]; then date -u -s "@$SE" >/dev/null 2>&1 || date -u -s "$(date -u -d "@$SE" '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1; command -v hwclock >/dev/null 2>&1 && hwclock -w -u >/dev/null 2>&1; fi
        log "clock check: the Kindle was ${DF}s off - corrected"
    else log "clock check: ok (${DF}s)"; fi
}

# ---------- 10.10: what the Kindle's screen tool can do (logged once per version): placing a picture at a
# position (needed for the loop-drawn clock digits and the weather animation) and the fast no-flash mode.
probe_eips() {
    [ "$(cat "$DIR/.sleepcaps_v" 2>/dev/null)" = "$VERSION" ] && return
    EH=$(eips -h 2>&1; eips 2>&1); EH=$(printf '%s' "$EH" | tr -cd 'A-Za-z0-9 _<>|=.,:/()\n-' | head -c 1500)
    EX=0; EW=0
    printf '%s' "$EH" | grep -q -- '-x' && printf '%s' "$EH" | grep -q -- '-y' && EX=1
    printf '%s' "$EH" | grep -qi -- '-w\|waveform' && EW=1
    printf 'EIPS_XY=%s\nEIPS_W=%s\n' "$EX" "$EW" > "$DIR/.sleepcaps"
    echo "$VERSION" > "$DIR/.sleepcaps_v"
    log "screen tool: place pictures at x,y: $([ "$EX" = 1 ] && echo yes || echo NO) | fast mode: $([ "$EW" = 1 ] && echo yes || echo NO)"
    log "screen tool says: $(printf '%s' "$EH" | tr '\n' ' ' | cut -c1-300)"
}


# Sync in a background subshell; result lands in .last_sync, which the main loop re-reads.
SYNC_PID=""
LAST_SYNC_TRY=0
log_due() {      # 10.7: something failed (launch, rollback, update), the page never started, or a day since the last upload
    [ -s "$DIR/.log_want" ] && return 0
    [ -f "$DIR/.boot_fail" ] && [ "$DIR/.boot_fail" -nt "$DIR/.log_up_at" ] && return 0
    LU=$(cat "$DIR/.log_up_at" 2>/dev/null | tr -cd '0-9')
    [ -z "$LU" ] || [ $(( $(date +%s) - LU )) -ge 86400 ]
}
start_sync() {   # 10.10: "" = full SYNC (you asked) | lists = edit burst (lists only, short) | daily = the 3 am session
    if [ "$BOOT" = "1" ]; then BOOT_SYNC=1; [ "$1" = "lists" ] || BOOT_FULL=1; return; fi   # 10.4.1: after the page is up
    [ "$1" = "lists" ] || LAST_SYNC_TRY=$(date +%s)
    case "$1" in lists) en_add bursts ;; daily) en_add daily ;; *) en_add syncs ;; esac
    (
        # $$ in a subshell is the parent's pid: without this the EXIT trap would run cleanup() here
        trap - EXIT INT TERM
        SY0=$(date +%s)
        # an edit burst waits 20 s for Wi-Fi at most (the edit is safe on the Kindle and goes with the next one)
        if wifi_on "$([ "$1" = "lists" ] && echo 20 || echo "$WIFI_TIMEOUT")"; then
            [ "$1" = "daily" ] && clock_check
            if cloud_ready; then
                N=0
                while [ "$N" -lt 3 ]; do
                    rm -f "$DIR/.cloud_dirty"
                    nice -n 10 sh "$DIR/hub_cloud.sh" sync          # 10.10: low priority, so the screen stays quick
                    [ -f "$DIR/.cloud_dirty" ] || break     # an edit arrived mid-sync: go again before Wi-Fi drops
                    N=$((N + 1))
                done
            fi
            if [ "$1" != "lists" ]; then
                # weather, news, deals ... in one package; the daily session only takes it if the brain made a new one
                USE_CLOUD_DATA=$USE_CLOUD_DATA ONLY_IF_NEW=$([ "$1" = "daily" ] && echo 1 || echo 0) nice -n 10 /bin/sh "$DIR/sync_data.sh"
                NOWS=$(date +%s)
                echo "$NOWS" > "$LAST_SYNC_F"
                log "$([ "$1" = "daily" ] && echo "daily session" || echo "sync") done at $(fmt_epoch "$NOWS")"
                if cloud_ready; then
                    write_cloud_js                                # 9.8.5: the cloud brain's links (TV, calendar) for the page
                    # 10.3: the book cloud - fetch books you put on the Kindle, remove ones you moved back
                    { [ -s "$DIR/.books_want" ] || [ -s "$DIR/.books_have" ]; } && nice -n 10 sh "$DIR/hub_books.sh"
                fi
                # 10.10: the nightly update check rides along with the daily session (no Wi-Fi of its own)
                if [ "$1" = "daily" ] && [ "$AUTO_UPDATE" != "0" ] && grep -q 'PAGES_URL="*http' "$DIR/cloud.conf" 2>/dev/null; then
                    date +%Y-%m-%d > "$DIR/.update_auto_day"
                    if [ "$AUTO_UPDATE" = "2" ] && [ ! -f "$DIR/.update/pending" ]; then
                        sh "$DIR/hub_update.sh" auto && { log "night update installed - restarting the hub"; echo "night update installed" > "$DIR/.relaunch"; }
                    else sh "$DIR/hub_update.sh" check; fi
                fi
                # the log (with the energy report) goes to your cloud gist with every sync and the daily session
                if cloud_ready && { [ "$1" = "daily" ] || [ -z "$1" ] || log_due; }; then
                    [ "$1" = "daily" ] && [ -f "$DIR/hub_sys.sh" ] && sh "$DIR/hub_sys.sh" >/dev/null 2>&1      # one system snapshot a day for the log
                    LU0=$(cat "$DIR/.log_up_at" 2>/dev/null)
                    sh "$DIR/hub_cloud.sh" log
                    [ "$(cat "$DIR/.log_up_at" 2>/dev/null)" != "$LU0" ] && rm -f "$DIR/.log_want"
                fi
            fi
        else
            log "wifi did not connect within $([ "$1" = "lists" ] && echo 20 || echo "$WIFI_TIMEOUT")s$([ "$1" = "lists" ] && echo ' - the edit goes with the next one')"
        fi
        wifi_off
        [ "$1" = "lists" ] && log "edit burst: $(( $(date +%s) - SY0 ))s"
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
                        *) log "update: install failed (see sync.log)"; echo "update install failed $(date '+%m-%d %H:%M')" >> "$DIR/.log_want" ;;
                    esac ;;
                update-auto)
                    date +%Y-%m-%d > "$DIR/.update_auto_day"
                    sh "$DIR/hub_update.sh" auto
                    [ "$?" = "0" ] && { log "night update installed - restarting the hub"; echo "night update installed" > "$DIR/.relaunch"; } ;;
                logup) [ -f "$DIR/hub_sys.sh" ] && sh "$DIR/hub_sys.sh" >/dev/null 2>&1; sh "$DIR/hub_cloud.sh" log ;;      # 10.10: the system snapshot only for SEND LOG
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

# 10.9: the settings port needs a key. Before 10.9 anything on the home Wi-Fi could stop the hub, roll back
# an update, send phone alerts or (with notify=@file) mail a file off the Kindle. The key is made here once,
# kept in .port_key (only this Kindle has it) and handed to the page in mesquite/portkey.js, which is never
# served over the network (the port only ever answers "ok").
# (hub_port_key, in hub_common.sh, also runs in run_hub.sh BEFORE the page opens)
hub_port_key; PORT_KEY=$HC_PORT_KEY
hub_totp_init
KEY_BAD_LOGGED=0
# 10.10: pure shell (was echo | tr | sed | head: ~150 programs started per tap, the main reason taps felt slow)
qv() { case "&$QS" in *"&$1="*) QV_T="&$QS"; QV_T=${QV_T#*"&$1="}; printf '%s\n' "${QV_T%%&*}" ;; esac; }
num_or_empty() { case "$1" in ''|*[!0-9]*) echo "" ;; *) echo "$1" ;; esac; }

# One ~1 s listen for a request from the page. Handles: touch=1, snooze=N (seconds; 1 = 5 min),
# interval=, window=, ss= (0 off, 1 eips, 2 eips+slots), pillow=0/1/2, rotate=1.
# 10.9.4: data.js didn't load on the page ("Parse error @ data.js:N"): describe line N once per start, so the
# cause can be found from the log (length, invisible line-separator / control characters, how it starts/ends).
data_js_diag() {
    [ "${DJ_DIAG:-0}" = 1 ] && return; DJ_DIAG=1
    DJF="$HUB_DIR/mesquite/data.js"; [ -f "$DJF" ] || { log "data.js: not there"; return; }
    DJN=$(printf '%s' "$1" | sed -n 's/.*data\.js:\([0-9][0-9]*\).*/\1/p'); DJN=${DJN:-5}
    sed -n "${DJN}p" "$DJF" > "$HUB_DIR/.dj_line"
    DJL=$(wc -c < "$HUB_DIR/.dj_line" | tr -d ' ')
    DJS=$(grep -c "$(printf '\342\200\250')\|$(printf '\342\200\251')" "$HUB_DIR/.dj_line")
    DJC=$(tr -d '\n' < "$HUB_DIR/.dj_line" | tr -cd '\000-\010\013\014\016-\037' | wc -c | tr -d ' ')
    DJA=$(cut -c1-70 "$HUB_DIR/.dj_line" | tr -cd ' -~'); DJE=$(tail -c 70 "$HUB_DIR/.dj_line" | tr -cd ' -~')
    log "data.js line $DJN: $DJL bytes, $(wc -l < "$DJF" | tr -d ' ') lines in all, line separators: $DJS, control chars: $DJC"
    log "data.js line $DJN starts: $DJA"
    log "data.js line $DJN ends: $DJE"
    rm -f "$HUB_DIR/.dj_line"
}
poll_settings_http() {
    if [ "$HAVE_NC" != "1" ]; then sleep 1; return; fi
    # 10.5: nc runs in the background with a watchdog. BusyBox nc only gives up on its own when nobody
    # connects; a page that connects and then freezes (Kindle error box) kept the socket open and blocked
    # the loop forever - no standby, no auto-rollback, a Kindle that needed a reboot.
    : > "$NC_OUT"
    NC_BIND=""; [ "$LOCAL_ONLY" = "1" ] && NC_BIND="-s 127.0.0.1"
    printf 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok' | nc -l -p 8765 $NC_BIND -w 1 > "$NC_OUT" 2>/dev/null &
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
    QS=$(echo "$REQ" | sed -n 's#.* /save?\([^ ]*\) HTTP.*#\1#p')
    NOWQ=$(date +%s)
    # 10.9.2: the page's start-up black box (a tiny script at the top of the page, separate from the big one):
    # how far the page got (pgl) and any script error (pgerr). No key needed - it only writes a line to the
    # log (at most 40 per start) and changes nothing, so a page that never says "I'm up" leaves its reason here.
    PGL=$(qv pgl); PGE=$(qv pgerr)
    if [ -n "$PGL$PGE" ]; then
        PG_N=$(( ${PG_N:-0} + 1 ))
        if [ "$PG_N" -le 40 ]; then
            [ -n "$PGL" ] && log "page start-up: $(urldecode "$PGL" | tr -cd 'A-Za-z0-9 :=.,/_()-' | cut -c1-120)"
            [ -n "$PGE" ] && log "page SCRIPT ERROR: $(urldecode "$PGE" | tr -cd 'A-Za-z0-9 :=.,/_()@#|<>[]-' | cut -c1-220)"
            case "$PGE" in *data.js*) data_js_diag "$(urldecode "$PGE")" ;; esac
        fi
        return
    fi
    # 10.9: no key, no action (logged at most once a minute so a noisy device can't fill the log).
    # 10.9.1: EXCEPT the page's "I'm up": start-up and a fresh update's health check must never depend on the
    # key (10.9 rolled back on a Kindle where the page's key never matched). They change nothing else.
    PKQ=$(qv pk)
    if [ "$PKQ" != "$PORT_KEY" ]; then
        if [ $((NOWQ - KEY_BAD_LOGGED)) -ge 60 ]; then
            KEY_BAD_LOGGED=$NOWQ
            if [ -z "$PKQ" ]; then log "settings port: a request with NO key (page key file not loaded?) - only start-up is let through"
            else log "settings port: a request with the WRONG key (${#PKQ} chars, loop has ${#PORT_KEY}) - only start-up is let through"; fi
        fi
        [ "$BOOT" = "1" ] && boot_done
        HV=$(cut -d' ' -f1 "$DIR/.update/pending" 2>/dev/null | tr -cd 'A-Za-z0-9.-')
        [ -n "$HV" ] && sh "$DIR/hub_update.sh" health "$HV" && [ ! -f "$DIR/.update/pending" ] && log "update $HV confirmed by the page"
        hub_port_key; PORT_KEY=$HC_PORT_KEY                      # rewrite portkey.js in case the page lost it
        return
    fi
    [ "$BOOT" = "1" ] && boot_done
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
        cloud_ready && [ "$EDIT_PUSH" = "now" ] && CLOUD_DUE=$((NOWQ + 12))     # a short lists-only burst after the last edit
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
        case "$V" in 1) LISTS_ON_WAKE=1 ;; *) LISTS_ON_WAKE=0 ;; esac
        CHANGED=1; write_cloud_js
        log "lists on button wake: $LISTS_ON_WAKE"
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
    # ---- 10.9: security (the page asks for an authenticator code before it sends any of these) ----
    if [ "$(qv totpon)" = "1" ] && [ ! -f "$DIR/.totp_on" ]; then
        date +%s > "$DIR/.totp_on"; hub_totp_init; log "authenticator set up"
    fi
    if [ "$(qv cloudok)" = "1" ] && [ -f "$DIR/.totp_on" ] && [ ! -f "$DIR/.cloud_ok" ]; then
        date +%s > "$DIR/.cloud_ok"; log "cloud: first connection allowed (authenticator code entered)"
        write_cloud_js; CLOUD_DUE=$((NOWQ + 5)); NEWU=$((NOWQ + 90)); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
    fi
    GT=$(qv ghtoken)
    if [ -n "$GT" ] && [ -f "$DIR/.totp_on" ]; then        # a new GitHub token, handed over by the phone (locked in the gist)
        case "$GT" in
            *[!A-Za-z0-9_]*) log "new GitHub token refused (odd characters)" ;;
            *) if [ ${#GT} -ge 20 ] && [ ${#GT} -le 255 ] && hub_conf_set GH_TOKEN "$GT"; then log "GitHub token replaced"; write_cloud_js; else log "new GitHub token refused"; fi ;;
        esac
    fi
    if [ "$(qv rotate)" = "1" ] && [ -f "$DIR/.totp_on" ]; then rotate_keys; fi
    if [ "$(qv keysdone)" = "1" ] && [ -f "$DIR/.totp_on" ]; then
        rm -f "$DIR/.pass_old"; hub_conf_set PASSPHRASE_OLD ""; log "key change finished: the old passphrase is forgotten"; write_cloud_js
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
        # 10.9: a tap during a quick wake turns it into a full one (page, light, lists from the phone)
        if [ "$QUICK_ACTIVE" = "1" ]; then
            QUICK_ACTIVE=0; WAKE_REASON=touch; set_light "$LIGHT_AWAKE"; write_ui_state 0; log "tapped during a quick wake - full wake"
            cloud_ready && [ "$LISTS_ON_WAKE" = "1" ] && ! sync_running && start_sync lists
        fi
    fi
    # 10.9: a command for the kitchen monitor, locked by the page with your passphrase ("~" + base64url)
    SCR=$(qv screen)
    if [ -n "$SCR" ]; then
        case "$SCR" in "~"*) ;; *) SCR="" ;; esac
        case "$SCR" in *[!A-Za-z0-9_~-]*) SCR="" ;; esac
        [ -n "$SCR" ] && [ ${#SCR} -le 1500 ] && screen_send "$SCR"
    fi
    # 10.9: Settings > System asks for a fresh look at CPU, memory and services
    if [ "$(qv sysinfo)" = "1" ] && [ "$BOOT" != "1" ] && [ -f "$DIR/hub_sys.sh" ]; then SYS_AT=$NOWQ; sh "$DIR/hub_sys.sh" >/dev/null 2>&1 & fi
    # 10.9: power settings from Settings > Sleep
    # 10.10: Settings > Sleep (each saved at once)
    V=$(qv sleepclock);  case "$V" in min|15|hour|off) SLEEP_CLOCK=$V; CHANGED=1; log "standby clock: $V" ;; esac
    V=$(qv nightclock);  case "$V" in same|hour|off) NIGHT_CLOCK=$V; CHANGED=1; log "night clock: $V" ;; esac
    V=$(qv nightdeghost); case "$V" in 0|1) NIGHT_DEGHOST=$V; CHANGED=1 ;; esac
    V=$(qv hourly);      case "$V" in 0|1) HOURLY_REFRESH=$V; CHANGED=1; log "hourly redraw: $V" ;; esac
    V=$(qv wxanim);      case "$V" in 0|1) WX_ANIM=$V; CHANGED=1 ;; esac
    V=$(qv timertick);   case "$V" in 0|1) TIMER_TICK=$V; CHANGED=1 ;; esac
    V=$(qv syncmode);    case "$V" in manual|2|6|12) SYNC_MODE=$V; CHANGED=1; log "sync: $V" ;; esac
    V=$(qv editpush);    case "$V" in now|sync) EDIT_PUSH=$V; CHANGED=1; log "Kindle edits: $V" ;; esac
    V=$(qv daily);       case "$V" in 0|1) DAILY_SESSION=$V; CHANGED=1; log "daily session: $V" ;; esac
    V=$(qv lowsaver);    case "$V" in 0|1) LOWBATT_SAVER=$V; CHANGED=1 ;; esac
    V=$(qv clockdraw);   case "$V" in auto|page) CLOCK_DRAW=$V; CHANGED=1; log "clock drawn by: $V" ;; esac
    V=$(qv clockmode);   case "$V" in min) SLEEP_CLOCK=min; CHANGED=1 ;; 15) SLEEP_CLOCK=15; CHANGED=1 ;; esac      # (10.9 pages)
    V=$(num_or_empty "$(qv timerend)"); [ -n "$V" ] && TIMER_END=$V      # a kitchen timer started (0 = stopped)
    # where the standby page put its clock digits and weather picture (screen pixels), for the sleep clock
    V=$(qv sclk); case "$V" in [sml]_*) printf '%s\n' "$V" | tr '_' ' ' | tr -cd 'a-z0-9 \n' > "$DIR/.sleep_geo" ;; none) rm -f "$DIR/.sleep_geo" ;; esac
    V=$(qv swx);  case "$V" in [a-z]*_*) printf '%s\n' "$V" | tr '_' ' ' | tr -cd 'a-z0-9 \n' > "$DIR/.sleep_wx" ;; none) rm -f "$DIR/.sleep_wx" ;; esac
    V=$(qv light)
    if [ "$V" = "keep" ]; then LIGHT_AWAKE=keep; CHANGED=1; log "frontlight: left to the Kindle"
    elif [ -n "$(num_or_empty "$V")" ]; then [ "$V" -gt 24 ] && V=24; LIGHT_AWAKE=$V; CHANGED=1; set_light "$V"; log "frontlight: $V"; fi
    SNZ=$(num_or_empty "$(qv snooze)")
    if [ -n "$SNZ" ] && [ "$SNZ" != "0" ]; then
        [ "$SNZ" = "1" ] && SNZ=300
        NEWU=$((NOWQ + SNZ))
        [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
        log "staying awake ${SNZ}s (requested from the hub)"
    fi
    V=$(num_or_empty "$(qv interval)"); [ -n "$V" ] && { INTERVAL_MIN=$V; SYNC_EVERY_MIN=$V; CHANGED=1; }
    # 10.6: smart schedule settings and your work times (from the page's shift calendar)
    V=$(num_or_empty "$(qv smart)");  [ -n "$V" ] && { case "$V" in 0|1) SMART_SLEEP=$V ;; esac; CHANGED=1; }
    V=$(num_or_empty "$(qv home)");   [ -n "$V" ] && { HOME_MIN=$V; CHANGED=1; }
    V=$(num_or_empty "$(qv away)");   [ -n "$V" ] && { AWAY_MIN=$V; CHANGED=1; }
    V=$(num_or_empty "$(qv night)");  [ -n "$V" ] && { NIGHT_MIN=$V; CHANGED=1; }
    V=$(num_or_empty "$(qv nf)");     [ -n "$V" ] && { NIGHT_FROM=$V; CHANGED=1; }
    V=$(num_or_empty "$(qv nt)");     [ -n "$V" ] && { NIGHT_TO=$V; CHANGED=1; }
    V=$(qv aw | tr -cd '0-9,-')
    if [ -n "$V" ] || [ "$(qv aw0)" = "1" ]; then
        printf '%s' "$V" | tr ',' '\n' | sed -n 's/^\([0-9]\{9,11\}\)-\([0-9]\{9,11\}\)$/\1 \2/p' | head -n 30 > "$DIR/.away.tmp"
        if ! cmp -s "$DIR/.away.tmp" "$DIR/.away"; then mv "$DIR/.away.tmp" "$DIR/.away"; log "work times from the calendar: $(grep -c . "$DIR/.away") in the next week"; else rm -f "$DIR/.away.tmp"; fi
    fi
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
        log "settings saved: interval=${INTERVAL_MIN}m window=${WAKE_WINDOW}s screenshot=${SCREENSAVER_MODE} hide-statusbar=${PILLOW_DISABLE} smart=${SMART_SLEEP} (home ${HOME_MIN}m, work ${AWAY_MIN}m, night ${NIGHT_MIN}m ${NIGHT_FROM}-${NIGHT_TO})"
    fi
    write_ui_state 0
}

# cloud.conf -> mesquite/cloud.js so the page can show the pairing code and sync status
ntfy_topic() {
    T=""; [ -f "$DIR/cloud.conf" ] && T=$(sed -n 's/^NTFY_TOPIC=//p' "$DIR/cloud.conf" | tr -cd 'A-Za-z0-9_-' | head -c 64)
    [ -n "$T" ] && { echo "$T"; return; }
    if [ ! -s "$DIR/.ntfy_topic" ]; then
        R=$(head -c 10 /dev/urandom | od -An -v -tx1 2>/dev/null | tr -d ' \n')
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
            # 10.9: the text goes in from our own temp file. With -d "$1", a message starting with @ made curl
            # send a FILE (e.g. cloud.conf) instead. A file (not stdin) because kcurl may try more than once.
            NF=$(mktemp 2>/dev/null) || NF="/tmp/kh_ntfy.$$"
            ( umask 077; printf '%s' "$1" > "$NF" )
            C=$(kcurl -s --connect-timeout 8 --max-time 20 -o /dev/null -w '%{http_code}' -H "Title: Kitchen Hub" -H "Tags: alarm_clock" -H "Priority: high" --data-binary "@$NF" "https://ntfy.sh/$TOPIC" 2>/dev/null)
            rm -f "$NF"
            log "phone alert sent ($C): $(printf '%s' "$1" | cut -c1-80)"
        else log "phone alert: no Wi-Fi"; fi
        [ "$WAS" = "CONNECTED" ] || sync_running || wifi_off
    ) &
}
# 10.9: MAKE NEW KEYS (Settings > Security, after an authenticator code). New passphrase, alert topic and
# monitor topic, all from the Kindle's random source. The passphrase before this one is kept as
# PASSPHRASE_OLD so everything locked with it still opens until the page has re-locked it and you tap
# FINISH; the phone, PC and TV get the new keys from a new sealed pairing code on the Kindle.
rand_b32() { head -c "$1" /dev/urandom | od -An -v -tu1 2>/dev/null | awk 'BEGIN { A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" } { for (i = 1; i <= NF; i++) printf "%s", substr(A, $i % 31 + 1, 1) }'; }
rotate_keys() {
    [ -f "$DIR/cloud.conf" ] || { log "new keys: no cloud.conf"; return; }
    OLDP=$( PASSPHRASE="@unset@"; . "$DIR/cloud.conf" >/dev/null 2>&1; [ "$PASSPHRASE" = "@unset@" ] && PASSPHRASE=$(hc_legacy_pass); printf '%s' "$PASSPHRASE" )
    R=$(rand_b32 24)
    [ ${#R} = 24 ] || { log "new keys: no random source - nothing changed"; return; }
    NEWP=$(echo "$R" | sed 's/\(....\)/\1-/g; s/-$//')         # XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (about 118 bits)
    NTN="kitchenhub-$(head -c 10 /dev/urandom | od -An -v -tx1 | tr -cd 'a-f0-9')"
    MTN="khscreen-$(head -c 10 /dev/urandom | od -An -v -tx1 | tr -cd 'a-f0-9')"
    # the old one goes in its own private file (any characters), not cloud.conf; FINISH deletes it
    [ -n "$OLDP" ] && ( umask 077; printf '%s' "$OLDP" > "$DIR/.pass_old" )
    hub_conf_set PASSPHRASE "$NEWP" || { rm -f "$DIR/.pass_old"; log "new keys: could not write cloud.conf"; return; }
    hub_conf_set NTFY_TOPIC "$NTN"; hub_conf_set MON_TOPIC "$MTN"
    date +%s > "$DIR/.keys_at"
    write_cloud_js
    log "new keys made (passphrase, alert topic, monitor topic) - re-pair the phone, PC and TV, then update the GitHub secrets"
}
# 10.9: the kitchen monitor's channel (ntfy topic). Made once from the Kindle's random source when missing;
# the TV/monitor learns it from its sealed pairing code (Settings > Security > TV / MONITOR).
mon_topic_init() {
    [ -f "$DIR/cloud.conf" ] || return 0
    grep -q '^MON_TOPIC=khscreen-[0-9a-f]\{20\}' "$DIR/cloud.conf" && return 0
    MT="khscreen-$(head -c 10 /dev/urandom | od -An -v -tx1 2>/dev/null | tr -cd 'a-f0-9')"
    [ ${#MT} = 29 ] && hub_conf_set MON_TOPIC "$MT" && log "made the kitchen monitor's channel"
}
# 10.9: send one (already locked) command to the kitchen monitor. Wi-Fi stays on 90 s for the next tap.
screen_send() {
    MT=$(sed -n 's/^MON_TOPIC=\(khscreen-[0-9a-f]*\)$/\1/p' "$DIR/cloud.conf" 2>/dev/null | head -1)
    [ -n "$MT" ] || { log "screen: no monitor channel yet"; return; }
    NEWU=$(( $(date +%s) + 90 )); [ "$NEWU" -gt "$AWAKE_UNTIL" ] && AWAKE_UNTIL=$NEWU
    (
        trap - EXIT INT TERM
        SF=$(mktemp 2>/dev/null) || SF="/tmp/kh_scr.$$"
        ( umask 077; printf '%s' "$1" > "$SF" )
        if wifi_on; then
            C=$(kcurl -s --connect-timeout 8 --max-time 15 -o /dev/null -w '%{http_code}' -H "Cache: no" --data-binary "@$SF" "https://ntfy.sh/$MT" 2>/dev/null)
            [ "$C" = "200" ] || log "screen: send failed ($C)"
        else log "screen: no Wi-Fi"; fi
        rm -f "$SF"
        sleep 90; sync_running || wifi_off
    ) &
}
write_cloud_js() {
    mon_topic_init
    NT=$(ntfy_topic)
    if [ -f "$DIR/cloud.conf" ]; then
        # 10.9: pass0 = the passphrase before the last key change (still opens older items); legacy=1 when
        # cloud.conf has no PASSPHRASE and the pre-10.9 built-in one is in use (the page asks you to make new
        # keys); mon = the kitchen monitor's topic; cok = this Kindle may use the cloud (authenticator code given)
        ( GIST_ID=""; GH_TOKEN=""; PAGES_URL=""; PASSPHRASE="@unset@"; PASSPHRASE_OLD=""; MON_TOPIC=""; . "$DIR/cloud.conf"
          LEG=0; [ "$PASSPHRASE" = "@unset@" ] && { PASSPHRASE=$(hc_legacy_pass); LEG=1; }      # no PASSPHRASE line at all (PASSPHRASE= empty means no lock, as before)
          [ -z "$PASSPHRASE_OLD" ] && [ -s "$DIR/.pass_old" ] && PASSPHRASE_OLD=$(cat "$DIR/.pass_old")
          Q() { echo "$1" | sed 's/[\\"]//g'; }
          LK() { sed -n "s/^$1=\\([A-Za-z0-9:/._-]*\\)\$/\\1/p" "$DIR/.cloud_links" 2>/dev/null | head -1; }
          CDA=$(cat "$DIR/.cloud_data_at" 2>/dev/null | tr -cd '0-9'); BA=$(LK BRAIN_AT | tr -cd '0-9')
          COK=0; hub_cloud_allowed && COK=1
          KAT=$(cat "$DIR/.keys_at" 2>/dev/null | tr -cd '0-9')
          printf 'window.HUB_CLOUD={pages:"%s",gist:"%s",token:"%s",pass:"%s",pass0:"%s",legacy:%s,mon:"%s",cok:%s,keysAt:%s,wake:%s,ntfy:"%s",alerts:%s,cdata:%s,cdataAt:%s,ics:"%s",ics2:"%s",tv:"%s",cgist:"%s",brainAt:%s};\n' "$(Q "$PAGES_URL")" "$(Q "$GIST_ID")" "$(Q "$GH_TOKEN")" "$(Q "$PASSPHRASE")" "$(Q "$PASSPHRASE_OLD")" "$LEG" "$(Q "$MON_TOPIC")" "$COK" "${KAT:-0}" "$LISTS_ON_WAKE" "$NT" "$PHONE_ALERTS" \
              "$USE_CLOUD_DATA" "${CDA:-0}" "$(LK ICS_URL)" "$(LK ICS2_URL)" "$(LK TV_REF)" "$(LK CLOUD_GIST)" "${BA:-0}" > "$MESQ/cloud.js.tmp" && mv "$MESQ/cloud.js.tmp" "$MESQ/cloud.js" )
    else
        printf 'window.HUB_CLOUD={pages:"",gist:"",token:"",pass:"",pass0:"",legacy:0,mon:"",cok:0,keysAt:0,wake:%s,ntfy:"%s",alerts:%s};\n' "$LISTS_ON_WAKE" "$NT" "$PHONE_ALERTS" > "$MESQ/cloud.js"
    fi
}
CURL_BIN=/usr/bin/curl; [ -x "$CURL_BIN" ] || CURL_BIN=curl
CURL="$CURL_BIN"; [ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"; command -v kcurl >/dev/null 2>&1 || kcurl() { "$CURL_BIN" "$@"; }     # 10.5: never unchecked when kcurl.sh is missing
cloud_ready() { [ -f "$DIR/cloud.conf" ] && [ -f "$DIR/hub_cloud.sh" ]; }

# 10.6: how long to sleep now. Sets STEP (the interval, seconds), SMODE (home | away | night | fixed) and
# BOUND (epoch when that period ends, 0 = none). Times of day use the hub's fixed UTC-7, like fmt_epoch.
smart_step() {
    STEP=$((INTERVAL_MIN * 60)); SMODE=fixed; BOUND=0
    [ "$SMART_SLEEP" = "1" ] || return 0
    NOWS=$(date +%s); LSEC=$(( (NOWS - 25200) % 86400 ))
    SMODE=home; STEP=$((HOME_MIN * 60))
    F=$((NIGHT_FROM * 3600)); T=$((NIGHT_TO * 3600)); NIGHT=0
    if [ "$F" -gt "$T" ]; then { [ "$LSEC" -ge "$F" ] || [ "$LSEC" -lt "$T" ]; } && NIGHT=1
    elif [ "$F" -lt "$T" ]; then [ "$LSEC" -ge "$F" ] && [ "$LSEC" -lt "$T" ] && NIGHT=1; fi
    if [ "$NIGHT" = "1" ]; then SMODE=night; STEP=$((NIGHT_MIN * 60)); BOUND=$(( NOWS + (T - LSEC + 86400) % 86400 )); fi
    if [ -s "$DIR/.away" ]; then
        while IFS=' ' read -r AS AE; do
            case "$AS$AE" in ''|*[!0-9]*) continue ;; esac
            if [ "$NOWS" -ge "$AS" ] && [ "$NOWS" -lt "$AE" ]; then
                SMODE=away; STEP=$((AWAY_MIN * 60)); BOUND=$AE; break
            fi
        done < "$DIR/.away"
    fi
    [ -n "$HUB_TEST_STEP" ] && STEP=$HUB_TEST_STEP      # tests only
}

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
# 10.9: the frontlight (0 = off). "keep" (the default) = never touched. With a level chosen: on only while the
# hub is awake for you, off at every standby.
set_light() { [ "${1:-keep}" = keep ] && return 0; [ "$HUB_TEST" = "1" ] && { echo "light $1" >> "${KT:-/tmp}/light.log" 2>/dev/null; return 0; }; lipc-set-prop com.lab126.powerd flIntensity "${1:-0}" 2>/dev/null; }
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

paint_eink() { if [ "${PAINT_FULL:-0}" = "1" ]; then eips -f -g "$1"; else eips -g "$1"; fi >/dev/null 2>&1; }      # 10.10: full (flashing) on the hourly redraw: clears ghosting

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
            [ "$SUSPEND_QUIET" = "1" ] || log "woke on schedule after ${SLEPT}s${WR:+ (reason: $WR)}$([ "$ATTEMPTS" -gt 0 ] && echo " - suspended on try $((ATTEMPTS + 1))")"
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

# =====================  10.10: THE SLEEP CLOCK  =====================
# While the hub sleeps the Kindle wakes for a moment each minute (or 15 min) and the loop draws only the clock
# digits that changed, straight onto the screen (pictures in mesquite/art, the same ones the page uses, so they
# match). No page work, no Wi-Fi. On the hour the standby page is redrawn (full refresh: clears ghosting) and the
# weather animation plays. Everything here is arithmetic on the clock: no programs started per decision.
ART="$MESQ/art"
is_night_at() {      # $1 = epoch
    NL=$(( ($1 - 25200) % 86400 )); NF=$((NIGHT_FROM * 3600)); NT=$((NIGHT_TO * 3600))
    if [ "$NF" -gt "$NT" ]; then [ "$NL" -ge "$NF" ] || [ "$NL" -lt "$NT" ]; elif [ "$NF" -lt "$NT" ]; then [ "$NL" -ge "$NF" ] && [ "$NL" -lt "$NT" ]; else return 1; fi
}
clk_at() {           # the standby clock mode at epoch $1: min | 15 | hour | off
    if is_night_at "$1" && [ "$NIGHT_CLOCK" != "same" ]; then CLK_M=$NIGHT_CLOCK; else CLK_M=$SLEEP_CLOCK; fi
}
saver_on() { [ "$LOWBATT_SAVER" = "1" ] && [ "$CHG" != "1" ] && [ -n "$B" ] && [ "$B" -lt 15 ] 2>/dev/null; }
hourly_wanted() {    # is there an hourly redraw at epoch $1?
    clk_at "$1"
    if is_night_at "$1"; then
        case "$CLK_M" in hour) return 0 ;; min|15) [ "$NIGHT_DEGHOST" = "1" ] ;; *) return 1 ;; esac
    else
        [ "$HOURLY_REFRESH" = "1" ] || [ "$CLK_M" = "hour" ]
    fi
}
tick_secs() {        # seconds between clock ticks at epoch $1 (0 = no ticks)
    clk_at "$1"
    case "$CLK_M" in min) TK=60 ;; 15) TK=900 ;; *) TK=0 ;; esac
    [ "$TK" = "60" ] && saver_on && TK=900
    [ "$TIMER_TICK" = "1" ] && [ "${TIMER_END:-0}" -gt "$1" ] && TK=60
    [ -n "$HUB_TEST_TICK" ] && [ "$TK" != "0" ] && TK=$HUB_TEST_TICK      # tests only (a short "minute")
}
tick_label() { tick_secs "$1"; case "$TK" in 60) echo "every minute ($(clock_by))" ;; 900) echo "every 15 min ($(clock_by))" ;; *) echo "$CLK_M (no ticks)" ;; esac; }
clock_by() {         # who draws the minute: the loop (pictures at x,y) or the page (it redraws itself)
    if [ "$CLOCK_DRAW" = "auto" ] && grep -q '^EIPS_XY=1' "$DIR/.sleepcaps" 2>/dev/null && [ -s "$DIR/.sleep_geo" ] && [ -d "$ART/clk" ] &&
       ! { [ "$TIMER_TICK" = "1" ] && [ "${TIMER_END:-0}" -gt "$(date +%s)" ]; }; then echo loop; else echo page; fi
}
next_wake() {        # NEXT_WAKE_EPOCH + NW_WHY from the hourly redraws, the daily session and a chosen sync interval
    NWN=$1; NW=0; NW_WHY=""
    NH=$(( (NWN / 3600 + 1) * 3600 )); NI=0
    while [ "$NI" -lt 24 ]; do T=$((NH + NI * 3600)); if hourly_wanted "$T"; then NW=$T; NW_WHY="hourly redraw"; break; fi; NI=$((NI + 1)); done
    if [ "$DAILY_SESSION" = "1" ]; then
        DL=$(( (NWN - 25200) % 86400 )); DD=$(( (DAILY_HOUR * 3600 - DL + 86400) % 86400 )); [ "$DD" -lt 60 ] && DD=$((DD + 86400))
        T=$((NWN + DD)); if [ "$NW" = "0" ] || [ "$T" -lt "$NW" ]; then NW=$T; NW_WHY="daily session"; fi
    fi
    if [ "$SYNC_MODE" != "manual" ]; then
        T=$((LAST_SYNC + SYNC_MODE * 3600)); [ "$T" -lt $((NWN + 600)) ] && T=$((NWN + 600))
        if [ "$NW" = "0" ] || [ "$T" -lt "$NW" ]; then NW=$T; NW_WHY="sync every ${SYNC_MODE} h"; fi
    fi
    [ "$NW" = "0" ] && { NW=$((NWN + 21600)); NW_WHY="nothing planned"; }
    [ "$NW" -lt $((NWN + 60)) ] && NW=$((NWN + 60))
    [ -n "$HUB_TEST_STEP" ] && { NW=$((NWN + HUB_TEST_STEP)); NW_WHY="test step"; }      # tests only
    NEXT_WAKE_EPOCH=$NW
}
clock_glyphs() {     # the six clock slots for now: hour (2), colon, minutes (2), am/pm  - e.g. "b 9 c 0 5 pm"
    set -- $(date '+%I %M %p')
    CH1=${1%?}; CH2=${1#?}; [ "$CH1" = "0" ] && CH1=b
    CM1=${2%?}; CM2=${2#?}
    case "$3" in [Pp]*) CAP=pm ;; *) CAP=am ;; esac
    echo "$CH1 $CH2 c $CM1 $CM2 $CAP"
}
draw_clock_tick() {  # redraw only the slots whose digit changed (usually one)
    NEWG=$(clock_glyphs)
    [ "$NEWG" = "$CLK_LAST" ] && return 0
    read -r GSZ GROT X1 Y1 X2 Y2 X3 Y3 X4 Y4 X5 Y5 X6 Y6 < "$DIR/.sleep_geo" || return 1
    set -- $NEWG; G1=$1 G2=$2 G3=$3 G4=$4 G5=$5 G6=$6
    set -- $CLK_LAST; O1=$1 O2=$2 O3=$3 O4=$4 O5=$5 O6=$6
    for SL in 1 2 3 4 5 6; do
        eval "GN=\$G$SL; GO=\$O$SL; GX=\$X$SL; GY=\$Y$SL"
        [ "$GN" = "$GO" ] && continue
        F="$ART/clk/$GSZ/$GROT/$GN.png"
        [ -f "$F" ] && eips -g "$F" -x "$GX" -y "$GY" >/dev/null 2>&1
    done
    CLK_LAST=$NEWG
}
nap() { usleep "$1" 2>/dev/null || sleep 1; }      # $1 microseconds
play_wx_anim() {     # ~10 s simple loop of the current weather over the standby weather picture, then a still frame
    [ -s "$DIR/.sleep_wx" ] && grep -q '^EIPS_XY=1' "$DIR/.sleepcaps" 2>/dev/null || return 0
    read -r WK WROT WX WY < "$DIR/.sleep_wx" || return 0
    WD="$ART/wx/$WK/$WROT"; [ -f "$WD/s.png" ] || return 0
    WFL="-w du"; grep -q '^EIPS_W=1' "$DIR/.sleepcaps" || WFL=""
    WT0=$(date +%s); WN=0
    while [ $(( $(date +%s) - WT0 )) -lt 10 ]; do
        for WFR in 1 2 3 4 5 6 7 8; do
            [ -f "$WD/$WFR.png" ] || continue
            # the fast mode can be refused on some firmware: then the frames are drawn the normal way
            eips -g "$WD/$WFR.png" -x "$WX" -y "$WY" $WFL >/dev/null 2>&1 || { [ -n "$WFL" ] && { WFL=""; sed -i 's/^EIPS_W=1/EIPS_W=0/' "$DIR/.sleepcaps"; log "fast screen mode refused - animation uses the normal mode"; }; }
            WN=$((WN + 1)); nap 120000
        done
    done
    eips -g "$WD/s.png" -x "$WX" -y "$WY" >/dev/null 2>&1
    log "weather animation: $WK, $WN frames"
}
tick_suspend() {     # one RTC sleep until epoch $1; returns 0 = alarm, 2 = woke early (power button), 1 = refused
    echo 0 > "$RTC" 2>/dev/null; echo "$1" > "$RTC" 2>/dev/null
    [ "$(cat "$RTC" 2>/dev/null)" = "$1" ] || return 1
    TS0=$(date +%s); do_suspend; TRC=$?; TS1=$(date +%s)
    echo 0 > "$RTC" 2>/dev/null
    [ "$TRC" = "0" ] && [ "$TS1" -ge $(( $1 - 2 )) ] && return 0
    [ "$TRC" = "0" ] && [ $((TS1 - TS0)) -ge 1 ] && return 2
    return 1
}
sleep_clock() {      # sleep until epoch $1, ticking the standby clock; returns like suspend_for
    SC_END=$1
    tick_secs "$(date +%s)"
    [ "$TK" = "0" ] && { suspend_for $((SC_END - $(date +%s) - 3)); return $?; }
    RTC=$(rtc_path); [ -z "$RTC" ] && { log "no RTC wake alarm available"; return 1; }
    SC_BY=$(clock_by); SC_N=0; SC_CS=0; SC_SLOW=0; SC_FAIL=0
    freeze_powerd                                   # once for the whole sleep, not around every tick
    [ "$HUB_TEST" = "1" ] || sync
    while :; do
        NOWT=$(date +%s)
        tick_secs "$NOWT"
        if [ "$TK" = "0" ]; then NB=$SC_END; else NB=$(( (NOWT / TK + 1) * TK )); fi
        [ $((NB + 20)) -ge "$SC_END" ] && NB=$SC_END
        if [ $((NB - NOWT)) -lt 3 ]; then [ "$NB" = "$SC_END" ] && { SC_R=0; break; }; NB=$((NB + TK)); fi
        [ -n "$SC_TA" ] && { SC_TB=$(uptime_cs); SC_D=$((SC_TB - SC_TA)); SC_CS=$((SC_CS + SC_D)); [ "$SC_D" -gt 500 ] && SC_SLOW=$((SC_SLOW + 1)); SC_TA=""; }
        tick_suspend "$NB"; SC_R=$?
        if [ "$SC_R" = "1" ]; then
            SC_FAIL=$((SC_FAIL + 1)); [ "$SC_FAIL" -ge 3 ] && break
            sleep 3; continue
        fi
        SC_FAIL=0
        [ "$SC_R" = "2" ] && break
        [ "$NB" = "$SC_END" ] && { SC_R=0; break; }
        SC_TA=$(uptime_cs); SC_N=$((SC_N + 1))
        if [ "$SC_BY" = "loop" ]; then draw_clock_tick; else sleep 2; fi      # the page redraws the minute itself
        still_owner || { thaw_powerd; exit 0; }
    done
    thaw_powerd
    if [ "$SC_N" -gt 0 ]; then
        en_add ticks "$SC_N"; en_add tick_cs "$SC_CS"; [ "$SC_SLOW" -gt 0 ] && en_add slow "$SC_SLOW"
        log "standby clock: $SC_N ticks ($SC_BY, avg $(awk -v c="$SC_CS" -v n="$SC_N" 'BEGIN { printf "%.1f", c / n / 100 }') s awake$([ "$SC_SLOW" -gt 0 ] && echo ", $SC_SLOW slow"))"
    fi
    case "$SC_R" in 0) return 0 ;; 2) log "woke early - treating as power button"; return 2 ;; *) log "clock ticks: the Kindle refused to sleep"; return 1 ;; esac
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
# 10.10: the clock digit and weather animation pictures ship as one archive (one download in an update)
if [ -f "$DIR/sleepart.tar" ] && { [ ! -f "$ART/.v" ] || [ "$DIR/sleepart.tar" -nt "$ART/.v" ]; }; then
    rm -rf "$ART.new"; mkdir -p "$ART.new"
    if tar -xf "$DIR/sleepart.tar" -C "$ART.new" 2>/dev/null && [ -d "$ART.new/clk" ]; then
        rm -rf "$ART"; mv "$ART.new" "$ART"; touch "$ART/.v"; log "sleep clock pictures ready ($(find "$ART" -name '*.png' | wc -l) pictures)"
    else rm -rf "$ART.new"; log "sleep clock pictures: the archive could not be unpacked - the page draws the clock"; fi
fi
probe_eips
en_day_check
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
    echo "page did not start $(date '+%m-%d %H:%M')" >> "$DIR/.log_want"
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
    en_day_check
    # 10.10: a timer wake is the HOURLY REDRAW (and, at DAILY_HOUR, the daily Wi-Fi session): the page stays on its
    # standby view, the new frame is captured, the weather animation plays, the minute clock goes on. Button =
    # full hub. Not while the page is starting or a fresh update still has to report in (that needs a full wake).
    QUICK_ACTIVE=0; HOURLY_NOW=0
    if [ "$WAKE_REASON" = "timer" ] && [ "$FIRST" != "1" ] && [ "$BOOT" != "1" ] && [ ! -f "$DIR/.update/pending" ]; then QUICK_ACTIVE=1; fi
    if [ "$QUICK_ACTIVE" = "1" ]; then
        AWAKE_UNTIL=$((NOW + ${HUB_QUICK_SEC:-8}))
        hourly_wanted "$NOW" && { HOURLY_NOW=1; en_add hourly; }
        QUICK_NEXT=1; write_ui_state 1
        log "$([ "$HOURLY_NOW" = 1 ] && echo "hourly redraw" || echo "timer wake"), battery ${B}%$( [ "$CHG" = "1" ] && echo ' charging')"
    else
        AWAKE_UNTIL=$((NOW + WAKE_WINDOW)); AWAKE_T0=$NOW
        NEXT_WAKE_EPOCH=0
        set_light "$LIGHT_AWAKE"
        write_ui_state 0
        case "$WAKE_REASON" in button|touch) en_add wake_btn ;; esac
        log "awake (${WAKE_REASON}) for ${WAKE_WINDOW}s, battery ${B}%$( [ "$CHG" = "1" ] && echo ' charging')"
        # (10.10: the task-manager probe only runs while Settings > System is open, or for SEND LOG)
    fi

    # 10.10: no automatic syncs unless you chose them (Settings > Sleep > Sync). First start: only if the data is
    # over 6 hours old. Never retried more than every 15 min.
    if [ "$FIRST" = "1" ]; then
        [ $((NOW - LAST_SYNC)) -ge 21600 ] && start_sync
    elif [ "$SYNC_MODE" != "manual" ] && [ $((NOW - LAST_SYNC)) -ge $((SYNC_MODE * 3600 - 180)) ] && [ $((NOW - LAST_SYNC_TRY)) -ge 900 ]; then
        start_sync
    fi
    # 10.10: the daily session (one Wi-Fi session: clock check, phone/Siri/PC commands + lists, new cloud data if
    # any, update check, energy report + log). On the first timer wake at or after DAILY_HOUR each day.
    if [ "$DAILY_SESSION" = "1" ] && [ "$WAKE_REASON" = "timer" ] && [ "$(date +%H | sed 's/^0//')" -ge "$DAILY_HOUR" ] && [ "$(cat "$DIR/.daily_day" 2>/dev/null)" != "$(date +%Y-%m-%d)" ]; then
        date +%Y-%m-%d > "$DIR/.daily_day"
        if sync_running; then log "daily session waits for the running sync"; else log "daily session"; start_sync daily; fi
    fi
    # woken by hand: phone list changes only if you asked for that (Settings > Sleep)
    if ! sync_running && cloud_ready && [ "$LISTS_ON_WAKE" = "1" ]; then
        case "$WAKE_REASON" in button|touch) start_sync lists ;; esac
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
        # 10.10: a sync or edit burst finished: the page re-reads its data once (no timers re-reading it)
        if sync_running; then SYNC_WAS=1; elif [ "$SYNC_WAS" = "1" ]; then SYNC_WAS=0; DATA_N=$((DATA_N + 1)); read_last_sync; SEEN_SYNC="$LAST_SYNC"; write_ui_state "$([ "$QUICK_ACTIVE" = 1 ] && echo 1 || echo 0)"; fi
        still_owner || { log "another loop owns $PIDF - exiting"; exit 0; }
    done
    SYNC_PID=""
    [ "$QUICK_ACTIVE" != "1" ] && [ -n "$AWAKE_T0" ] && { en_add awake_s $(( $(date +%s) - AWAKE_T0 )); AWAKE_T0=""; }

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
    next_wake "$NOW"
    log "next wake $(fmt_epoch "$NEXT_WAKE_EPOCH") ($NW_WHY); standby clock: $(tick_label "$NOW")"

    QUICK_NEXT=1
    [ "$LIGHT_AWAKE" != keep ] && set_light 0      # only if you chose a light level for the hub
    write_ui_state 1
    write_log_js
    [ "$QUICK_ACTIVE" = "1" ] && sleep 3 || sleep 6   # give the page time to draw the standby frame before it is captured

    if [ "$SCREENSAVER_MODE" != "off" ]; then
        PAINT_FULL=$HOURLY_NOW capture_and_freeze_display
        # 10.10: the weather animation (~10 s) over the standby weather picture, on the hourly redraw
        [ "$HOURLY_NOW" = "1" ] && [ "$WX_ANIM" = "1" ] && ! saver_on && play_wx_anim
    fi
    QUICK_ACTIVE=0; HOURLY_NOW=0
    CLK_LAST=$(clock_glyphs)                   # what the page just drew; ticks only redraw digits that change

    if [ "$MODE" = "eco" ]; then
        sleep_clock "$NEXT_WAKE_EPOCH"
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
