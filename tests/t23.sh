# 10.10.1: a request during the hourly redraw or while getting ready to sleep keeps the page on its standby view
# (it used to wake the page up), the clock / weather positions are heard in the seconds before standby, and a tap in
# those seconds keeps the hub awake. Run: KH_TESTS=$(pwd) sh t23.sh   (about 2 minutes)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export HUB_SUSPEND_CMD='T=$(cat "$HUB_RTC_CANDIDATES"); N=$(date +%s); [ "$T" -gt "$N" ] && sleep $((T - N)); exit 0'
export HUB_TEST_STEP=30 HUB_QUICK_SEC=8
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nAUTO_UPDATE=0\nNIGHT_FROM=0\nNIGHT_TO=0\nDAILY_SESSION=0\nSLEEP_CLOCK=hour\n' > "$HUB_DIR/eco.conf"
echo "$(( $(date +%s) - 600 ))" > "$HUB_DIR/.last_sync"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
# 1. a request during the hourly redraw (the page reporting where its clock is) must not wake the page
waitfor 'grep -q "hourly redraw, battery" "$HUB_DIR/power.log"' 90
R=$(ping_page "timerend=0")
grep -q 'sleeping: 1' "$HUB_DIR/mesquite/state.js" && ok "request during the hourly redraw ($R): page stays on standby" || bad "page woken by a request: $(grep -o 'sleeping: [01]' "$HUB_DIR/mesquite/state.js")"
grep -q 'tapped during a quick wake' "$HUB_DIR/power.log" && bad "a plain request counted as a tap" || ok "a plain request is not a tap"
# 2. positions sent in the seconds before standby arrive
L1=$(wc -l < "$HUB_DIR/power.log")
waitfor '[ $(sed -n "$L1,\$p" "$HUB_DIR/power.log" | grep -c "next wake") -ge 1 ]' 40
R=$(ping_page "sclk=m_90_1017_26_1017_108_1017_190_1017_240_1017_322_1017_404")
sleep 1; [ -s "$HUB_DIR/.sleep_geo" ] && ok "clock position heard while getting ready to sleep ($R)" || bad "no .sleep_geo ($R): $(sed -n "$L1,\$p" "$HUB_DIR/power.log" | tail -4 | tr "\n" " ")"
grep -q 'sleeping: 1' "$HUB_DIR/mesquite/state.js" && ok "and the page stays on standby" || bad "page woken while getting ready to sleep"
# 3. a tap in those seconds keeps the hub awake
L2=$(wc -l < "$HUB_DIR/power.log")
waitfor '[ $(sed -n "$L2,\$p" "$HUB_DIR/power.log" | grep -c "next wake") -ge 1 ]' 60
ping_page "touch=1" >/dev/null
waitfor 'grep -q "tapped while going to standby - staying awake\|tapped during a quick wake" "$HUB_DIR/power.log"' 10 && ok "tap while going to standby: $(grep -o 'tapped while going to standby - staying awake\|tapped during a quick wake - full wake' "$HUB_DIR/power.log" | tail -1)" || bad "tap lost: $(tail -3 "$HUB_DIR/power.log")"
waitfor 'grep -q "awake (touch)\|full wake" "$HUB_DIR/power.log"' 10 && grep -q 'sleeping: 0' "$HUB_DIR/mesquite/state.js" && ok "full wake, page told sleeping 0" || bad "no full wake: $(tail -3 "$HUB_DIR/power.log")"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
