#!/bin/sh
# Kitchen Hub 10.5: the ONE way to stop the hub. Everything else (the launcher, Reset, Soft reset, the
# diagnostics buttons) calls this instead of carrying its own kill list.
#   stop_hub.sh          stop everything and give the Kindle back: sleep, status bar, Wi-Fi off, Home
#   stop_hub.sh launch   stop everything, repair system state, but leave the screen alone (the launcher
#                        is about to start the hub again)
#   stop_hub.sh jobs     stop only the background jobs (syncs, cloud, update, books, web pages)
# Stopping is TERM first; KILL only for what ignores TERM, and then the system state is repaired.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
WHAT="${1:-full}"
HC_WHO=stop
. "$DIR/hub_common.sh"

JOBS=""
for S in sync_data.sh hub_cloud.sh hub_update.sh hub_books.sh hub_merge.sh; do
    JOBS="$JOBS $(hc_pids_matching "$S")"
done
NJ=$(hc_stop_pids 4 $JOBS)
NC=$(hc_stop_pids 2 $(hc_nc_pids))
rm -f "$DIR/.job_next" "$DIR/.web_next" "$DIR/.rsearch_next" "$DIR/.relaunch" /tmp/kitchenhub_nc.* 2>/dev/null
JC=$(echo $JOBS | wc -w | tr -d ' ')
if [ "$WHAT" = "jobs" ]; then
    hc_log "stopped $JC background job(s)$([ "$NJ" != "0" ] && echo ", $NJ needed KILL")"
    exit 0
fi

# the loop: TERM lets it run its own cleanup (powerd, alarms, governor, status bar)
LOOPS="$(cat "$HC_LOOP_PIDF" 2>/dev/null | tr -cd '0-9') $(hc_pids_matching power_loop.sh)"
LOOPS=$(for P in $LOOPS; do hc_alive "$P" && echo "$P"; done | sort -u)
NL=$(hc_stop_pids 8 $LOOPS)
rm -f "$HC_LOOP_PIDF"

# the page: ask the app manager first, then stop what is left of OUR mesquite only
PG=$(hub_page_pids)
if [ -n "$PG" ]; then
    lipc-set-prop com.lab126.appmgrd stop "app://$HC_APP" 2>/dev/null
    T=0; while [ "$T" -lt 6 ] && hub_page_running; do sleep 1; T=$((T + 1)); done
    NP=$(hc_stop_pids 4 $(hub_page_pids))
else NP=0; fi
rm -f "$HC_MESQ_PIDF"

# always repair: if the loop was KILLed (or died earlier), its cleanup never ran
hc_repair_system
hc_log "stopped: loop $(echo $LOOPS | wc -w | tr -d ' ') (KILL $NL), page $(echo $PG | wc -w | tr -d ' ') (KILL $NP), jobs $JC (KILL $NJ)"
[ "$WHAT" = "launch" ] && exit 0

lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
status pillow 2>/dev/null | grep -q "stop/" && start pillow >/dev/null 2>&1 && sleep 2
status statusbar 2>/dev/null | grep -q "stop/" && start statusbar >/dev/null 2>&1
lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.showMe();"}' 2>/dev/null
lipc-set-prop com.lab126.cmd wirelessEnable 0 2>/dev/null
lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home 2>/dev/null
hc_log "hub stopped - the Kindle is back to normal"
