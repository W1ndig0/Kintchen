# 10.10: timer wakes are the hourly redraw (quick: the page stays on its standby view), a tap during one or the
# power button = full wake, the frontlight, the new Sleep settings, and the sleep clock: ticks drawn by the loop
# (digit pictures at the positions the page reported) or by the page when the screen tool can't place pictures.
# Run: KH_TESTS=$(pwd) sh t15.sh   (about 5 minutes)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
# a "suspend" that really waits for the RTC alarm, unless $KT/button exists (then it is a power-button press after 3 s)
export HUB_SUSPEND_CMD='if [ -f "$KT/button" ]; then rm -f "$KT/button"; sleep 3; exit 0; fi; T=$(cat "$HUB_RTC_CANDIDATES"); N=$(date +%s); [ "$T" -gt "$N" ] && sleep $((T - N)); exit 0'
export HUB_TEST_STEP=40 HUB_QUICK_SEC=6
CONF='INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nAUTO_UPDATE=0\nLIGHT_AWAKE=7\nNIGHT_FROM=0\nNIGHT_TO=0\nDAILY_SESSION=0\nSLEEP_CLOCK=hour\n'
printf "$CONF" > "$HUB_DIR/eco.conf"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_page vp=1x1 >/dev/null
waitfor 'grep -q "hourly redraw, battery" "$HUB_DIR/power.log"' 90 && ok "timer wake is the hourly redraw" || bad "no hourly redraw: $(tail -3 "$HUB_DIR/power.log")"
grep -q 'sleeping: 1' "$HUB_DIR/mesquite/state.js" && grep -q 'quick: 1' "$HUB_DIR/mesquite/state.js" && ok "page told: stay on the standby view (sleeping 1, quick 1)" || bad "state during the redraw: $(grep -E 'sleeping|quick' "$HUB_DIR/mesquite/state.js" | tr -d '\n')"
grep -q 'light 7' "$KT/light.log" && grep -q 'light 0' "$KT/light.log" && ok "frontlight on (7) while awake, off for standby" || bad "light log: $(cat "$KT/light.log" 2>/dev/null | tr '\n' ' ')"
grep -q 'eips -f -g' "$KT/sys.log" || true
L1=$(grep -n 'hourly redraw, battery' "$HUB_DIR/power.log" | tail -1 | cut -d: -f1)
waitfor '[ $(sed -n "$L1,\$p" "$HUB_DIR/power.log" | grep -c "next wake") -ge 1 ]' 30 && ok "the redraw went back to sleep by itself" || bad "redraw did not end"
# a tap during the next redraw -> full wake
N0=$(grep -c 'hourly redraw, battery' "$HUB_DIR/power.log")
waitfor '[ $(grep -c "hourly redraw, battery" "$HUB_DIR/power.log") -gt '"$N0"' ]' 60
ping_page touch=1 >/dev/null; sleep 2
grep -q 'tapped during a quick wake - full wake' "$HUB_DIR/power.log" && grep -q 'sleeping: 0' "$HUB_DIR/mesquite/state.js" && ok "tap during the redraw: full wake (page told sleeping 0)" || bad "tap not upgraded: $(tail -3 "$HUB_DIR/power.log")"
grep -q 'start_sync\|lists sync' "$HUB_DIR/power.log" && bad "a tap turned Wi-Fi on" || ok "a tap doesn't fetch phone changes (Wi-Fi stays off)"
# the power button is a full wake
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1; sleep 1
: > "$HUB_DIR/power.log"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "next wake" "$HUB_DIR/power.log"' 40; touch "$KT/button"
waitfor 'grep -q "awake (button)" "$HUB_DIR/power.log"' 60 && ok "power button: full wake" || bad "button: $(tail -3 "$HUB_DIR/power.log")"
# the new settings from the page, each saved at once
ping_page "sleepclock=15&nightclock=hour&hourly=0&wxanim=0&syncmode=6&editpush=sync&daily=1&lowsaver=0&clockdraw=page&light=30" >/dev/null; sleep 3
C="$HUB_DIR/eco.conf"
grep -q '^SLEEP_CLOCK=15' "$C" && grep -q '^NIGHT_CLOCK=hour' "$C" && grep -q '^HOURLY_REFRESH=0' "$C" && grep -q '^WX_ANIM=0' "$C" && grep -q '^SYNC_MODE=6' "$C" &&
  grep -q '^EDIT_PUSH=sync' "$C" && grep -q '^LOWBATT_SAVER=0' "$C" && grep -q '^CLOCK_DRAW=page' "$C" && grep -q '^LIGHT_AWAKE=24' "$C" && ok "Sleep settings saved (light capped at 24)" || bad "settings: $(grep -E 'SLEEP|NIGHT_C|HOURLY|WX_|SYNC_M|EDIT|LOWB|DRAW|LIGHT' "$C" | tr '\n' ' ')"
grep -q 'sleepClock: "15"' "$HUB_DIR/mesquite/state.js" && grep -q 'syncMode: "6"' "$HUB_DIR/mesquite/state.js" && ok "the page sees them (state.js)" || bad "state.js: $(grep -o 'sleepClock[^,]*\|syncMode[^,]*' "$HUB_DIR/mesquite/state.js" | tr '\n' ' ')"
ping_page "sleepclock=bogus&syncmode=99&nightclock=x" >/dev/null; sleep 2
grep -q '^SLEEP_CLOCK=15' "$C" && grep -q '^SYNC_MODE=6' "$C" && ok "nonsense values ignored" || bad "nonsense accepted"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1; sleep 1

# ---- the sleep clock, drawn by the loop: pictures + the positions the page reported + a screen tool that can place them
: > "$HUB_DIR/power.log"; : > "$KT/sys.log"
printf "$CONF" | sed 's/^SLEEP_CLOCK=hour/SLEEP_CLOCK=min/' > "$C"
mkdir -p "$HUB_DIR/mesquite/art" && tar -xf "$HUB_DIR/sleepart.tar" -C "$HUB_DIR/mesquite/art"
printf 'EIPS_XY=1\nEIPS_W=1\n' > "$HUB_DIR/.sleepcaps"; echo 10.10 > "$HUB_DIR/.sleepcaps_v"
export HUB_TEST_STEP=130 HUB_TEST_TICK=10
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
ping_page "sclk=m_90_1017_26_1017_108_1017_190_1017_240_1017_322_1017_404&swx=snow_90_751_26" >/dev/null
waitfor 'grep -q "standby clock: [0-9]* ticks (loop" "$HUB_DIR/power.log"' 200 && ok "$(grep -o 'standby clock: [0-9]* ticks (loop[^)]*)' "$HUB_DIR/power.log" | head -1)" || bad "no loop-drawn ticks: $(tail -4 "$HUB_DIR/power.log")"
grep -q 'clockBy: "loop"' "$HUB_DIR/mesquite/state.js" || grep -q 'standby clock: every minute (loop)' "$HUB_DIR/power.log" && ok "page told: the loop draws the minutes" || bad "clockBy not loop"
D=$(grep 'eips -g .*/art/clk/m/90/[0-9b]\.png -x 1017 -y \(26\|108\|240\|322\)' "$KT/sys.log" | head -1)
[ -n "$D" ] && ok "a changed digit drawn at its slot: ${D#*art/}" || bad "no digit drawn at a reported slot: $(grep 'art/clk' "$KT/sys.log" | head -2)"
[ "$(grep -c 'art/clk' "$KT/sys.log")" -le 6 ] && ok "only changed digits are drawn ($(grep -c 'art/clk' "$KT/sys.log") pictures)" || bad "too many digit draws: $(grep -c 'art/clk' "$KT/sys.log")"
[ "$(grep -c 'woke on schedule' "$HUB_DIR/power.log")" -le 2 ] && ok "ticks are not logged one by one" || bad "log flooded: $(grep -c 'woke on schedule' "$HUB_DIR/power.log") lines"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1; sleep 1
# ---- the same without a screen tool that can place pictures: the page draws the minute
: > "$HUB_DIR/power.log"; : > "$KT/sys.log"
printf 'EIPS_XY=0\nEIPS_W=0\n' > "$HUB_DIR/.sleepcaps"
export HUB_TEST_STEP=40
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "standby clock: [0-9]* ticks" "$HUB_DIR/power.log"' 120 && grep -q 'standby clock: [0-9]* ticks (page' "$HUB_DIR/power.log" && ok "no picture placing: the page draws the minute" || bad "fallback: $(grep 'standby clock' "$HUB_DIR/power.log" | tail -2)"
grep -q 'art/clk' "$KT/sys.log" && bad "the loop drew digits without being able to place them" || ok "the loop draws nothing then"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
echo "--- power.log tail"; tail -6 "$HUB_DIR/power.log"
