# 10.9: quick timer wakes, a tap during one, the frontlight, the "every minute" standby clock.
# Run: KH_TESTS=$(pwd) sh t15.sh   (about 3 minutes)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
# a "suspend" that really waits for the RTC alarm, unless $KT/button exists (then it is a power-button press after 3 s)
export HUB_SUSPEND_CMD='if [ -f "$KT/button" ]; then rm -f "$KT/button"; sleep 3; exit 0; fi; T=$(cat "$HUB_RTC_CANDIDATES"); N=$(date +%s); [ "$T" -gt "$N" ] && sleep $((T - N)); exit 0'
export HUB_TEST_STEP=40 HUB_QUICK_SEC=6
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nCLOUD_ON_WAKE=0\nAUTO_UPDATE=0\nLIGHT_AWAKE=7\n' > "$HUB_DIR/eco.conf"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_page vp=1x1 >/dev/null
waitfor 'grep -q "quick wake (timer)" "$HUB_DIR/power.log"' 90 && ok "timer wake is a quick wake" || bad "no quick wake: $(tail -3 "$HUB_DIR/power.log")"
grep -q 'sleeping: 1' "$HUB_DIR/mesquite/state.js" && grep -q 'quick: 1' "$HUB_DIR/mesquite/state.js" && ok "page told: stay on the standby view (sleeping 1, quick 1)" || bad "state during quick wake: $(grep -E 'sleeping|quick' "$HUB_DIR/mesquite/state.js" | tr -d '\n')"
grep -q 'light 7' "$KT/light.log" && grep -q 'light 0' "$KT/light.log" && ok "frontlight on (7) while awake, off for standby" || bad "light log: $(cat "$KT/light.log" 2>/dev/null | tr '\n' ' ')"
# the quick wake ends by itself without a full wake window
L1=$(grep -n 'quick wake (timer)' "$HUB_DIR/power.log" | tail -1 | cut -d: -f1)
waitfor '[ $(sed -n "$L1,\$p" "$HUB_DIR/power.log" | grep -c "next wake\|woke") -ge 1 ]' 30
QS=$(grep 'quick wake (timer)' "$HUB_DIR/power.log" | tail -1 | cut -c7-14); QE=$(sed -n "$L1,\$p" "$HUB_DIR/power.log" | grep -m1 'next wake' | cut -c7-14)
[ -n "$QE" ] && ok "quick wake went back to sleep ($QS -> $QE)" || bad "quick wake did not end"
# a tap during the next quick wake -> full wake
N0=$(grep -c 'quick wake (timer)' "$HUB_DIR/power.log")
waitfor '[ $(grep -c "quick wake (timer)" "$HUB_DIR/power.log") -gt '"$N0"' ]' 60
ping_page touch=1 >/dev/null; sleep 2
grep -q 'tapped during a quick wake - full wake' "$HUB_DIR/power.log" && grep -q 'sleeping: 0' "$HUB_DIR/mesquite/state.js" && ok "tap during a quick wake: full wake (page told sleeping 0)" || bad "tap not upgraded: $(tail -3 "$HUB_DIR/power.log")"
# the power button is a full wake as before
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1; sleep 1
: > "$HUB_DIR/power.log"
echo QUICK_WAKE=1 >> "$HUB_DIR/eco.conf"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "next wake" "$HUB_DIR/power.log"' 40; touch "$KT/button"
waitfor 'grep -q "awake (button)" "$HUB_DIR/power.log"' 60 && ok "power button: full wake" || bad "button: $(tail -3 "$HUB_DIR/power.log")"
# settings from the page
ping_page "clockmode=min&quickwake=1&light=30" >/dev/null; sleep 3
grep -q '^CLOCK_MODE=min' "$HUB_DIR/eco.conf" && grep -q '^LIGHT_AWAKE=24' "$HUB_DIR/eco.conf" && ok "settings saved (clock every minute, light capped at 24)" || bad "settings: $(grep -E 'CLOCK|LIGHT' "$HUB_DIR/eco.conf" | tr '\n' ' ')"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1; sleep 1
# the every-minute clock: tick by tick until the next real wake
: > "$HUB_DIR/power.log"
export HUB_TEST_STEP=60 HUB_TEST_MINUTE=10
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "standby clock: [0-9]* minute ticks" "$HUB_DIR/power.log"' 120 && ok "standby clock ticks: $(grep -o 'standby clock: [0-9]* minute ticks' "$HUB_DIR/power.log" | head -1)" || bad "no minute ticks: $(tail -4 "$HUB_DIR/power.log")"
[ "$(grep -c 'woke on schedule' "$HUB_DIR/power.log")" -le 2 ] && ok "minute ticks are not logged one by one" || bad "log flooded: $(grep -c 'woke on schedule' "$HUB_DIR/power.log") lines"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
echo "--- power.log tail"; tail -6 "$HUB_DIR/power.log"
