# 10.10: Wi-Fi only when it's needed. No syncs by themselves (timer wakes, button presses), the daily session
# once a day, a lean edit burst (or none with "with the next sync"), the energy report at a day change, the
# weather animation on the hourly redraw, and the one-time screen tool probe.
# Run: KH_TESTS=$(pwd) sh t22.sh   (about 4 minutes)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export HUB_SUSPEND_CMD='if [ -f "$KT/button" ]; then rm -f "$KT/button"; sleep 3; exit 0; fi; T=$(cat "$HUB_RTC_CANDIDATES"); N=$(date +%s); [ "$T" -gt "$N" ] && sleep $((T - N)); exit 0'
export HUB_TEST_STEP=30 HUB_QUICK_SEC=4 FAKE_WIFI=CONNECTED
H=$HUB_DIR; C="$H/eco.conf"
wifi_ons() { grep 'wirelessEnable 1' "$KT/lipc.log" 2>/dev/null | wc -l | tr -d ' '; }
printf 'PASSPHRASE=TEST-PASS-1234\n' > "$H/cloud.conf"
BASE='ECO_V=112\nSYNC_MODE=manual\nLISTS_ON_WAKE=0\nINTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nAUTO_UPDATE=0\nNIGHT_FROM=0\nNIGHT_TO=0\nSLEEP_CLOCK=hour\n'

# ---- 1. defaults: nothing turns Wi-Fi on by itself (timer wakes, a button press)
printf "$BASE"'DAILY_SESSION=0\n' > "$C"; : > "$KT/lipc.log"
echo "$(( $(date +%s) - 600 ))" > "$H/.last_sync"          # recent data: the first start doesn't sync either
sh "$H/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor '[ $(grep -c "hourly redraw, battery" "$H/power.log") -ge 2 ]' 120
touch "$KT/button"; waitfor 'grep -q "awake (button)" "$H/power.log"' 60
[ "$(wifi_ons)" = "0" ] && ok "two timer wakes and a button press: Wi-Fi never on" || bad "Wi-Fi turned on $(wifi_ons) times: $(grep -i 'sync\|wifi' "$H/power.log" | tail -3)"
grep -q 'next wake .* (hourly redraw)' "$H/power.log" || grep -q 'next wake .* (test step)' "$H/power.log" && ok "next wake planned: $(grep -o 'next wake [^;]*' "$H/power.log" | tail -1)" || bad "no plan logged"
# ---- 2. an edit on the Kindle: a short lists-only burst (no books, no log); none with "with the next sync"
R=$(ping_page "item=$(printf 'x1\tshop\topen\tmilk' | sed 's/\t/%09/g')")
waitfor 'grep -q "edit burst:" "$H/power.log"' 40 || { echo "  (ping: $R)"; grep -n 'button\|sync\|burst\|cloud' "$H/power.log" | tail -8; false; } && ok "edit -> $(grep -o 'edit burst: [0-9]*s' "$H/power.log" | tail -1) (lists only)" || bad "no edit burst: $(tail -3 "$H/power.log")"
grep -q 'hub_books\|log uploaded' "$H/power.log" && bad "the burst did more than the lists" || ok "the burst didn't run books or a log upload"
ping_page "editpush=sync" >/dev/null; sleep 2; N1=$(wifi_ons)
ping_page "item=$(printf 'x2\tshop\topen\teggs' | sed 's/\t/%09/g')" >/dev/null; sleep 20
[ "$(wifi_ons)" = "$N1" ] && ok "\"with the next sync\": an edit doesn't turn Wi-Fi on" || bad "Wi-Fi on after an edit with editpush=sync"
sh "$H/stop_hub.sh" launch >/dev/null 2>&1; sleep 1

# ---- 3. the daily session: once a day, on the first timer wake at or after its hour; clock check included
: > "$H/power.log"; : > "$KT/lipc.log"; rm -f "$H/.daily_day"
printf "$BASE"'DAILY_SESSION=1\nDAILY_HOUR=%s\n' "$(date +%H | sed 's/^0//')" > "$C"
sh "$H/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "daily session done\|daily session$" "$H/power.log"' 120 && ok "daily session ran" || bad "no daily session: $(tail -4 "$H/power.log")"
waitfor 'grep -q "clock check" "$H/power.log"' 30 && ok "it checked the clock: $(grep -o 'clock check: [^(]*' "$H/power.log" | head -1)" || bad "no clock check"
[ "$(cat "$H/.daily_day" 2>/dev/null)" = "$(date +%Y-%m-%d)" ] && ok "marked as done for today" || bad ".daily_day: $(cat "$H/.daily_day" 2>/dev/null)"
N2=$(grep -c '\] daily session$' "$H/power.log")
waitfor '[ $(grep -c "hourly redraw, battery" "$H/power.log") -ge 3 ]' 150
[ "$(grep -c '\] daily session$' "$H/power.log")" = "$N2" ] && ok "only once a day" || bad "daily session ran again"
sh "$H/stop_hub.sh" launch >/dev/null 2>&1; sleep 1

# ---- 4. the energy report at a day change; the screen tool probe; the weather animation
: > "$H/power.log"; : > "$KT/sys.log"
printf 'day 2026-01-01\nwake_btn 3\nawake_s 240\nhourly 20\nticks 600\ntick_cs 66000\nslow 2\nwifi_n 4\nwifi_s 150\nsyncs 1\nbursts 2\ndaily 1\n' > "$H/.energy"
echo 84 > "$H/.energy_b0"; rm -f "$H/.sleepcaps_v"
printf "$BASE"'DAILY_SESSION=0\nSCREENSAVER_MODE=eips\nWX_ANIM=1\n' > "$C"
mkdir -p "$H/mesquite/art" && tar -xf "$H/sleepart.tar" -C "$H/mesquite/art"
sh "$H/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
waitfor 'grep -q "energy 2026-01-01:" "$H/power.log"' 30 && ok "$(grep -o 'energy 2026-01-01: [^|]*|[^|]*|[^|]*| [0-9]* clock ticks (avg [0-9.]* s' "$H/power.log")" || bad "no energy report: $(head -5 "$H/power.log")"
grep -q 'window.HUB_ENERGY = {line: "energy 2026-01-01' "$H/mesquite/energy.js" && ok "energy.js for the page and the phone" || bad "energy.js: $(cat "$H/mesquite/energy.js" 2>/dev/null | head -c 120)"
grep -q 'screen tool: place pictures at x,y: NO' "$H/power.log" && grep -q '^EIPS_XY=0' "$H/.sleepcaps" && ok "screen tool probed once and logged" || bad "probe: $(grep 'screen tool' "$H/power.log")"
printf 'EIPS_XY=1\nEIPS_W=1\n' > "$H/.sleepcaps"
ping_page "swx=snow_90_751_26" >/dev/null
waitfor 'grep -q "weather animation: snow" "$H/power.log"' 120 && ok "$(grep -o 'weather animation: snow, [0-9]* frames' "$H/power.log" | head -1) on the hourly redraw" || bad "no animation: $(tail -4 "$H/power.log")"
grep -q 'eips -g .*/art/wx/snow/90/1.png -x 751 -y 26 -w du' "$KT/sys.log" && ok "frames drawn at the weather picture in the fast mode" || bad "frames: $(grep 'art/wx' "$KT/sys.log" | head -2)"
grep -q 'eips -g .*/art/wx/snow/90/s.png -x 751 -y 26$' "$KT/sys.log" && ok "ends on the still picture (normal mode)" || bad "no still frame"
sh "$H/stop_hub.sh" launch >/dev/null 2>&1
echo "--- power.log tail"; tail -5 "$H/power.log"
