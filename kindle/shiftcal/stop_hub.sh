#!/bin/sh
# Stops the hub loop(s), restores normal Kindle sleep and shows the status bar again.
DIR="/mnt/us/extensions/shiftcal"
PIDF="$DIR/.loop.pid"
MESQ_PIDF="$DIR/.mesquite.pid"

for P in $(cat "$PIDF" 2>/dev/null) $(ps | grep '[p]ower_loop.sh' | awk '{print $1}'); do kill "$P" 2>/dev/null; done
sleep 2
for P in $(ps | grep '[p]ower_loop.sh' | awk '{print $1}'); do kill -9 "$P" 2>/dev/null; done
for P in $(ps | grep '[n]c -l -p 8765' | awk '{print $1}'); do kill "$P" 2>/dev/null; done
rm -f "$PIDF"
[ -f "$MESQ_PIDF" ] && kill "$(cat "$MESQ_PIDF" 2>/dev/null)" 2>/dev/null && rm -f "$MESQ_PIDF"
killall mesquite 2>/dev/null

for r in /sys/class/rtc/rtc1/wakealarm /sys/class/rtc/rtc0/wakealarm; do [ -w "$r" ] && echo 0 > "$r" 2>/dev/null; done
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do [ -w "$g" ] && echo ondemand > "$g" 2>/dev/null; done
PD=$(pidof powerd 2>/dev/null); [ -n "$PD" ] && kill -CONT $PD 2>/dev/null
/sbin/start powerd 2>/dev/null || start powerd 2>/dev/null || initctl start powerd 2>/dev/null
lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
status pillow 2>/dev/null | grep -q "stop/" && start pillow >/dev/null 2>&1 && sleep 2
status statusbar 2>/dev/null | grep -q "stop/" && start statusbar >/dev/null 2>&1
lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.showMe();"}' 2>/dev/null
lipc-set-prop com.lab126.cmd wirelessEnable 0 2>/dev/null
echo "$(date '+%m-%d %H:%M:%S') [stop] stopped by user" >> "$DIR/power.log"
