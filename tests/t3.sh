. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
# A: double tap - two launchers at once
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1 & sleep 0.3; sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; wait
ping_page vp=1x1 >/dev/null; sleep 2
[ "$(starts)" = 1 ] && [ "$(loops)" = 1 ] && [ "$(pages)" = 1 ] && grep -q 'already running - this one stops' "$HUB_DIR/hub.log" && ok "double tap: second launcher stepped aside, 1 start" || bad "double tap starts=$(starts) loops=$(loops) pages=$(pages)"
# B: rid replay across a restart
R1=$(ping_page "touch=1&rid=777"); sleep 1; [ "$R1" = ok ] && [ "$(cat $HUB_DIR/.last_rid)" = 777 ] && ok "first request landed (id 777 remembered)" || bad "first request did not land ($R1)"; sleep 1
echo test > "$HUB_DIR/.relaunch"; OL=$(cat $HUB_DIR/.loop.pid)
waitfor '[ -n "$(cat $HUB_DIR/.loop.pid 2>/dev/null)" ] && [ "$(cat $HUB_DIR/.loop.pid)" != "$OL" ]' 40; sleep 3
ping_page "snooze=60&rid=777" >/dev/null; sleep 2
grep -q 'staying awake 60s' "$HUB_DIR/power.log" && bad "replayed request ran again after restart" || ok "replayed request id ignored after restart"
ping_page "snooze=61&rid=778" >/dev/null; sleep 2
grep -q 'staying awake 61s' "$HUB_DIR/power.log" && ok "new request id still handled" || bad "new rid ignored"
# C: a loop that ignores TERM (stuck) -> KILL + repair
sh "$HUB_DIR/stop_hub.sh" launch; sleep 1
cat > "$HUB_DIR/power_loop.sh.stuck" <<'S'
trap '' TERM
while :; do sleep 1; done
S
cp "$HUB_DIR/power_loop.sh.stuck" "$KT/power_loop.sh"; sh "$KT/power_loop.sh" & SP=$!; echo $SP > "$HUB_DIR/.loop.pid"; sleep 1
sh "$HUB_DIR/stop_hub.sh" launch 2>"$KT/stop.err"
kill -0 $SP 2>/dev/null && bad "stuck loop survived" || ok "stuck loop: TERM ignored, KILLed"
grep -q 'loop 1 (KILL 1)' "$HUB_DIR/power.log" && ok "the KILL was logged" || bad "KILL not logged"
[ -s "$KT/stop.err" ] && { bad "stop printed errors:"; cat "$KT/stop.err"; } || ok "stop printed no errors"
# D: page never talks to the loop -> clean stop (boot gate)
: > "$KT/lipc.log"
HUB_BOOT_WAIT=8 sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
waitfor '[ "$(loops)" = 0 ] && [ "$(pages)" = 0 ]' 30
[ "$(loops)" = 0 ] && [ "$(pages)" = 0 ] && ok "silent page: loop and page stopped" || bad "silent page loops=$(loops) pages=$(pages)"
waitfor 'grep -q "back to normal" "$HUB_DIR/power.log"' 15; grep -q 'booklet.home' "$KT/lipc.log" && ok "silent page: back to Home" || bad "no Home"
cat "$HUB_DIR/.boot_fail" 2>/dev/null | sed 's/^/   boot_fail: /'
echo "--- power.log tail"; tail -8 "$HUB_DIR/power.log"
