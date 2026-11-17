#!/bin/sh
# Kitchen Hub v9.9 launcher.  Usage: run_hub.sh [eco|always]
DIR="/mnt/us/extensions/shiftcal"
CONF="$DIR/eco.conf"
MODE="${1:-eco}"
LOG="$DIR/hub.log"
PIDF="$DIR/.loop.pid"
MESQ_PIDF="$DIR/.mesquite.pid"
MESQ_LOG="$DIR/mesquite.log"
export TZ="PCT7"

PILLOW_DISABLE=2
[ -f "$CONF" ] && . "$CONF"

[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 50000 ] && tail -n 100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exec >> "$LOG" 2>&1
echo "=== Launching Kitchen Hub v9.9 ($MODE) at $(date) ==="

chmod +x "$DIR"/*.sh 2>/dev/null
/bin/sh "$DIR/register_mesquite.sh"

# Stop EVERY older loop, not just the one in the pid file (v8.5 logs showed two loops fighting),
# plus any listener left behind on the settings port.
OLD=$(cat "$PIDF" 2>/dev/null)
for P in $OLD $(ps | grep '[p]ower_loop.sh' | awk '{print $1}'); do kill "$P" 2>/dev/null; done
T=0
while [ "$T" -lt 6 ] && ps | grep -q '[p]ower_loop.sh'; do sleep 1; T=$((T+1)); done
for P in $(ps | grep '[p]ower_loop.sh' | awk '{print $1}'); do echo "force-stopping old loop $P"; kill -9 "$P" 2>/dev/null; done
for P in $(ps | grep '[n]c -l -p 8765' | awk '{print $1}'); do kill "$P" 2>/dev/null; done
rm -f "$PIDF"

lipc-set-prop com.lab126.appmgrd stop app://com.custom.kitchenhub 2>/dev/null
killall mesquite 2>/dev/null
sleep 2

lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null
# 9.4 stopped the pillow service by mistake: make sure it is running again
status pillow 2>/dev/null | grep -q "stop/" && { echo "starting pillow again (9.4 had stopped it)"; start pillow >/dev/null 2>&1; sleep 2; }
if [ "$PILLOW_DISABLE" != "0" ]; then
    # like Jobman: stop the clock/battery bar BEFORE the hub window opens, so the window gets the space
    echo "hiding the Kindle status bar: $(stop statusbar 2>&1 | head -1)"
    HIDE_BAR=1
fi

lipc-set-prop com.lab126.appmgrd start app://com.custom.kitchenhub 2>/dev/null
sleep 3
if ! pidof mesquite >/dev/null 2>&1; then
    echo "appmgrd did not spawn mesquite; starting directly"
    setsid /bin/sh -c 'echo $$ > "$1"; exec /usr/bin/mesquite -l com.custom.kitchenhub -c "file:///mnt/us/extensions/shiftcal/mesquite/" -j' _ "$MESQ_PIDF" >> "$MESQ_LOG" 2>&1 < /dev/null &
    sleep 2
else
    pidof mesquite | awk '{print $1}' > "$MESQ_PIDF"
fi
echo "mesquite active, pid=$(cat "$MESQ_PIDF" 2>/dev/null)"
# the status bar is asked to hide after the hub window exists (power_loop repeats this on every wake)
if [ "$HIDE_BAR" = "1" ]; then
    lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.hideMe();"}' 2>/dev/null
    status statusbar 2>/dev/null | grep -q "stop/" || { echo "statusbar came back while launching - stopping again"; stop statusbar >/dev/null 2>&1; }
fi

setsid /bin/sh -c 'echo $$ > "$1"; exec /bin/sh "$2" "$3"' _ "$PIDF" "$DIR/power_loop.sh" "$MODE" >/dev/null 2>&1 < /dev/null &
sleep 1
echo "power_loop active, pid=$(cat "$PIDF" 2>/dev/null)"
