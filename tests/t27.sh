# 10.10.5: the standby clock was sometimes wrong because the hourly redraw ran a second or two BEFORE its target time and so
# drew the old hour / minute ("hour only" asks the Kindle to wake 3 s early on purpose). A wake now waits for its target.
# Here: hour-only clock, a suspend that returns exactly when the alarm is set (that is 3 s early), two redraws in a row:
# the loop's own clock at the start of each redraw (state.js "now") must not be before the time it was aiming for.
# Run: KH_TESTS=$(pwd) sh t27.sh   (about 2 minutes)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export HUB_SUSPEND_CMD='T=$(cat "$HUB_RTC_CANDIDATES"); N=$(date +%s); [ "$T" -gt "$N" ] && sleep $((T - N)); exit 0'
export HUB_TEST_STEP=30 HUB_QUICK_SEC=6
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nAUTO_UPDATE=0\nNIGHT_FROM=0\nNIGHT_TO=0\nDAILY_SESSION=0\nSLEEP_CLOCK=hour\n' > "$HUB_DIR/eco.conf"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "hourly redraw, battery" "$HUB_DIR/power.log"' 90 || bad "no first redraw: $(tail -3 "$HUB_DIR/power.log")"
REDRAWS() { grep -c 'hourly redraw, battery' "$HUB_DIR/power.log"; }
# the loop's own clock (state.js "now") the instant a redraw is logged - it is written just before the log line
NOW_AT_REDRAW() { i=0; while [ $i -lt 600 ]; do [ "$(REDRAWS)" -gt "$1" ] && { for K in 1 2 3 4 5 6 7 8; do V=$(sed -n 's/^ *now: *\([0-9]*\).*/\1/p' "$HUB_DIR/mesquite/state.js" | head -1); [ -n "$V" ] && { echo "$V"; return 0; }; sleep 0.05; done; return 1; }; sleep 0.1; i=$((i+1)); done; return 1; }
for R in 1 2 3; do
  C=$(REDRAWS)
  # asleep again after the previous redraw: state.js now holds the time the NEXT redraw aims at
  waitfor '[ "$(grep -c "next wake" "$HUB_DIR/power.log")" -ge '"$((C + 1))"' ]' 40
  sleep 1
  T=$(sed -n 's/.*nextWakeEpoch: *\([0-9]*\).*/\1/p' "$HUB_DIR/mesquite/state.js" | head -1)
  NOWS=$(NOW_AT_REDRAW "$C")
  if [ -n "$T" ] && [ "$T" -gt 0 ] && [ -n "$NOWS" ]; then
    [ "$NOWS" -ge "$T" ] && ok "redraw $R started at its target (aimed for $T, loop clock $NOWS)" || bad "redraw $R started $((T - NOWS)) s BEFORE its target (aimed for $T, loop clock $NOWS)"
  else bad "redraw $R: no target or clock to compare (target '$T', now '$NOWS'): $(tail -3 "$HUB_DIR/power.log")"; fi
done
[ -n "$T27_DEBUG" ] && { echo "--- power.log"; tail -25 "$HUB_DIR/power.log"; }
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
