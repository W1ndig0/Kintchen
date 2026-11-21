# 10.10.3: the things the overnight audit found. Every check here FAILS on 10.10.2.
#   1. a week with no work times (the page sends aw0=1) must not break state.js
#   2. state.js stays valid JavaScript whatever is in the files it reads from
#   3. a suspend that gets refused must not look like a 3% battery (saver mode)
#   4. MAKE NEW KEYS must not turn the Kindle's screen sideways
#   5. a stamp file cut off mid-write must not stop a sync
#   6. the energy report's "days left" comes from the battery, not from how much data we have
# Run: KH_TESTS=$(pwd) sh t24.sh   (about 1 minute)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
H=$HUB_DIR
valid_js() { node -e '
  var fs = require("fs"), vm = require("vm"), w = {};
  try { vm.runInNewContext(fs.readFileSync(process.argv[1], "utf8"), { window: w }); } catch (e) { console.log("BROKEN " + e.message); process.exit(1); }
  process.exit(0);' "$1" 2>&1; }
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nAUTO_UPDATE=0\nNIGHT_FROM=0\nNIGHT_TO=0\nDAILY_SESSION=0\nSLEEP_CLOCK=hour\n' > "$H/eco.conf"
echo "$(( $(date +%s) - 600 ))" > "$H/.last_sync"
sh "$H/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null

# ---- 1 + 2. no work times at all: the page says so, and state.js must still load
R=$(ping_page "aw0=1")
sleep 1
[ -f "$H/.away" ] && [ ! -s "$H/.away" ] && ok "no work times: the loop wrote an empty .away ($R)" || bad ".away: $(ls -l "$H/.away" 2>&1)"
M=$(valid_js "$H/mesquite/state.js")
[ -z "$M" ] && ok "state.js is still valid JavaScript (the page keeps getting state)" || bad "state.js $M: $(grep -n 'aways' "$H/mesquite/state.js")"
grep -q 'aways: 0' "$H/mesquite/state.js" && ok "and it says 0 work times" || bad "aways line: $(grep -o 'aways:.*' "$H/mesquite/state.js")"
# two real ones, then none again
ping_page "aw=$(( $(date +%s) + 60 ))-$(( $(date +%s) + 3600 )),$(( $(date +%s) + 86460 ))-$(( $(date +%s) + 90000 ))" >/dev/null; sleep 1
grep -q 'aways: 2' "$H/mesquite/state.js" && [ -z "$(valid_js "$H/mesquite/state.js")" ] && ok "two work times counted" || bad "aways: $(grep -o 'aways:.*' "$H/mesquite/state.js")"
ping_page "aw0=1" >/dev/null; sleep 1
grep -q 'aways: 0' "$H/mesquite/state.js" && [ -z "$(valid_js "$H/mesquite/state.js")" ] && ok "back to none, still valid" || bad "after clearing: $(grep -o 'aways:.*' "$H/mesquite/state.js")"
# every other number in state.js: junk in the files it reads must not break it either
printf 'PILLOW_DISABLE=\nSLEEP_CLOCK=\nDAILY_HOUR=x\n' >> "$H/eco.conf"
ping_page "touch=1" >/dev/null; sleep 3
[ -z "$(valid_js "$H/mesquite/state.js")" ] && ok "a damaged eco.conf does not break state.js" || bad "state.js $(valid_js "$H/mesquite/state.js")"
sh "$H/stop_hub.sh" launch >/dev/null 2>&1; sleep 1

# ---- 3. a refused suspend must not be read as a 3% battery
grep -nE '[[:space:]]B=\$\(\(3 \* ATTEMPTS' "$H/power_loop.sh" >/dev/null && bad "suspend back-off still overwrites the battery reading" || ok "the suspend back-off uses its own variable"
# and saver_on still works off the real battery
( . "$H/hub_common.sh" 2>/dev/null
  LOWBATT_SAVER=1; CHG=0; B=80; eval "$(sed -n '/^saver_on()/p' "$H/power_loop.sh")"
  saver_on && echo "saver on at 80%" || echo "saver off at 80%"
  B=9; saver_on && echo "saver on at 9%" || echo "saver off at 9%" ) > "$KT/saver.txt" 2>&1
grep -q 'saver off at 80%' "$KT/saver.txt" && grep -q 'saver on at 9%' "$KT/saver.txt" && ok "battery saver: off at 80%, on at 9%" || bad "saver: $(tr '\n' ' ' < "$KT/saver.txt")"

# ---- 4. MAKE NEW KEYS must not rotate the screen
: > "$KT/lipc.log"
printf 'GIST_ID=x\nGH_TOKEN=y\nPASSPHRASE=TEST-PASS-1234\n' > "$H/cloud.conf"; date +%s > "$H/.totp_on"
sh "$H/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null
ping_page "rotate=1" >/dev/null; sleep 2
grep -q 'orientationLock' "$KT/lipc.log" && bad "new keys turned the screen: $(grep -o 'orientationLock.*' "$KT/lipc.log" | head -1)" || ok "new keys leave the screen alone"
waitfor 'grep -q "new keys made\|new keys:" "$H/power.log"' 10 && ok "and the keys were made: $(grep -o 'new keys[^-]*' "$H/power.log" | tail -1)" || bad "no new keys: $(tail -2 "$H/power.log")"
sh "$H/stop_hub.sh" launch >/dev/null 2>&1

# ---- 5. a stamp file cut off mid-write must not stop the sync
: > "$H/.due_news_night"; : > "$H/.status_at"
OUT=$(cd "$H" && HUB_DIR="$H" USE_CLOUD_DATA=0 sh "$H/sync_data.sh" 2>&1; echo "rc=$?")
case "$OUT" in *"rc=0"*) ok "sync_data survives an empty stamp file" ;; *) bad "sync_data: $OUT" ;; esac
grep -q 'arithmetic' "$H/sync.log" && bad "arithmetic error in sync.log" || ok "no arithmetic error in the log"

# ---- 6. the energy report's "days left" comes from the battery
printf 'day 2026-01-01\nwake_btn 2\nawake_s 120\nticks 600\ntick_cs 60000\nwifi_n 3\nwifi_s 90\n' > "$H/.energy"
echo 90 > "$H/.energy_b0"
RATE7=0.50 HRS7=200 LEFT7=120 sh -c '. '"$H"'/hub_common.sh 2>/dev/null; DIR='"$H"'; EN_F="$DIR/.energy"; MESQ="$DIR/mesquite"
  battery_pct() { echo 78; }; log() { :; }
  '"$(sed -n '/^en_report() {/,/^}/p' "$H/power_loop.sh")"'
  en_report 2026-01-01'
L=$(cat "$H/.energy_last")
case "$L" in *"~5.0 days left"*) ok "days left from the battery: $(printf '%s' "$L" | sed 's/.*(\(7-day[^)]*\)).*/\1/')" ;; *) bad "report says: $L" ;; esac
case "$L" in *"battery 90%->78% (12% used"*) ok "and the battery line reads properly" ;; *) bad "battery part: $L" ;; esac
