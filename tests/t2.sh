. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_page vp=1x1 >/dev/null
# two wake cycles: window 4 s + 6 s standby frame + 2 s fake suspend
sleep 26
[ "$(starts)" = 1 ] && [ "$(doubles)" = 0 ] && ok "two wake cycles: still 1 app start, no double start" || bad "starts=$(starts) doubles=$(doubles)"
grep -c 'awake (' "$HUB_DIR/power.log" | sed 's/^/   wakes seen: /'
# the page dies -> reopened once at the next wake
kill $(pidof mesquite); sleep 16
[ "$(pages)" = 1 ] && [ "$(starts)" = 2 ] && [ "$(doubles)" = 0 ] && ok "page closed: reopened once" || bad "pages=$(pages) starts=$(starts) doubles=$(doubles)"
# a job asks for a restart
OLDLOOP=$(cat "$HUB_DIR/.loop.pid"); echo "test" > "$HUB_DIR/.relaunch"
waitfor '[ -n "$(cat $HUB_DIR/.loop.pid 2>/dev/null)" ] && [ "$(cat $HUB_DIR/.loop.pid)" != "$OLDLOOP" ]' 40
sleep 3
[ "$(loops)" = 1 ] && [ "$(pages)" = 1 ] && [ "$(doubles)" = 0 ] && ! kill -0 $OLDLOOP 2>/dev/null && ok "relaunch: old loop gone, 1 new loop, 1 page" || bad "loops=$(loops) pages=$(pages) doubles=$(doubles)"
grep -q 'KILL [1-9]' "$HUB_DIR/power.log" && bad "something needed KILL" || ok "nothing needed KILL"
# stop everything
sh "$HUB_DIR/stop_hub.sh"; sleep 1
[ "$(loops)" = 0 ] && [ "$(pages)" = 0 ] && ok "stop: no loop, no page" || bad "after stop loops=$(loops) pages=$(pages)"
grep -q 'start app://com.lab126.booklet.home' "$KT/lipc.log" && ok "stop: Kindle sent back to Home" || bad "no Home"
echo "--- power.log"; cat "$HUB_DIR/power.log"
