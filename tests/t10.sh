. "$KH_TESTS/env.sh"
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null; sleep 2
N=$(date +%s); ping_page "smart=1&home=15&away=120&night=180&nf=23&nt=6&rid=901" >/dev/null; sleep 1
ping_page "aw=$((N-600))-$((N+7200)),$((N+86400))-$((N+90000)),junk&rid=902" >/dev/null; sleep 2
[ "$(grep -c . $HUB_DIR/.away)" = 2 ] && ok "work times saved (2 kept, junk dropped)" || bad "away file: $(cat $HUB_DIR/.away)"
grep -q '^SMART_SLEEP=1$' $HUB_DIR/eco.conf && grep -q '^AWAY_MIN=120$' $HUB_DIR/eco.conf && ok "schedule saved in eco.conf" || bad "eco.conf"
waitfor 'grep -q "next wake .*(away, every 120 min)" $HUB_DIR/power.log' 30 && ok "at work: sleeps for the work interval, wakes when the shift ends" || bad "no away wake line"
grep -q 'where: "away"' $HUB_DIR/mesquite/state.js && grep -q 'aways: 2' $HUB_DIR/mesquite/state.js && ok "state.js tells the page (away, 2 work times)" || bad "state.js: $(grep -o 'where[^,]*,[^,]*' $HUB_DIR/mesquite/state.js)"
ping_page "aw0=1&rid=903" >/dev/null; sleep 1
[ ! -s "$HUB_DIR/.away" ] && ok "no shifts: work times cleared" || bad "aw0 did not clear"
sh "$HUB_DIR/stop_hub.sh" >/dev/null 2>&1
grep 'next wake\|work times' $HUB_DIR/power.log | head -4
