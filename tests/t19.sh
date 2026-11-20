# 10.9.2: the page's start-up black box. Without the key, "pgl" (how far the page got) and "pgerr" (a script
# error) are written to power.log, they don't count as "I'm up" and they do nothing else. Run: KH_TESTS=$(pwd) sh t19.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export HUB_BOOT_WAIT=60
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_nokey "pgl=main%3A%20SETTINGS%20after%206s%20files%20ktcd" >/dev/null; sleep 2
ping_nokey "pgerr=TypeError%3A%20x%20is%20undefined%20%40%20index.html%3A2919%20%5Bmain%5D%3Bsnooze%3D99" >/dev/null; sleep 2
grep -q 'page start-up: main' "$HUB_DIR/power.log" && ok "stage report logged" || bad "no stage line: $(tail -3 "$HUB_DIR/power.log")"
grep -q 'page SCRIPT ERROR: TypeError' "$HUB_DIR/power.log" && ok "script error logged" || bad "no error line"
grep -q 'page is up' "$HUB_DIR/power.log" && bad "a black-box report counted as start-up" || ok "reports don't count as start-up"
grep -v 'page SCRIPT ERROR' "$HUB_DIR/power.log" | grep -q 'staying awake\|snooze' && bad "text in a report was acted on" || ok "reports change nothing"
[ "$(loops)" = 1 ] && ok "the hub keeps running normally after reports" || bad "loop gone"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
