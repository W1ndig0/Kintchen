# 10.9.1: a page whose key never arrives still gets through start-up (10.9 rolled back on a Kindle), but
# nothing else works without the key. Run: KH_TESTS=$(pwd) sh t18.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export HUB_BOOT_WAIT=40
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_nokey "boot=10.9.1" >/dev/null; sleep 3
grep -q 'page is up after' "$HUB_DIR/power.log" && ok "start-up gets through without the key" || bad "keyless page not let through: $(tail -3 "$HUB_DIR/power.log")"
grep -q 'a request with NO key' "$HUB_DIR/power.log" && ok "the log says the page sent no key" || bad "no diagnosis in the log"
ping_nokey "snooze=65&rid=9101" >/dev/null; sleep 3
grep -q 'staying awake 65s' "$HUB_DIR/power.log" && bad "an action without the key was carried out" || ok "actions still need the key"
sleep 45
[ "$(loops)" = 1 ] && ok "hub still running after the start-up wait (no rollback, no stop)" || bad "hub stopped: $(tail -3 "$HUB_DIR/power.log")"
grep -q 'hub_sys\|task manager' "$HUB_DIR/power.log" && bad "probe ran during start-up" || ok "no probe during start-up"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
