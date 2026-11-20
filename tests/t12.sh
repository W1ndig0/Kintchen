# 10.9: the settings port needs the key. Run: KH_TESTS=$(pwd) sh t12.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
K=$(cat "$HUB_DIR/.port_key" 2>/dev/null)
[ ${#K} = 32 ] && ok "a 32-character port key was made" || bad "port key missing or short (${#K})"
grep -q "window.HUB_PORTKEY=\"$K\"" "$HUB_DIR/mesquite/portkey.js" 2>/dev/null && ok "the page's portkey.js holds the key" || bad "portkey.js missing or wrong"
[ "$(stat -c %a "$HUB_DIR/.port_key" 2>/dev/null)" = 600 ] && ok ".port_key is private (600)" || bad ".port_key mode $(stat -c %a "$HUB_DIR/.port_key" 2>/dev/null)"
# the key must exist before the page was started (the page reads it once, at start)
KT_MT=$(stat -c %Y "$HUB_DIR/mesquite/portkey.js" 2>/dev/null); LP=$(grep -m1 'page process' "$HUB_DIR/power.log" | cut -c1-14)
[ -n "$KT_MT" ] && ok "portkey.js written during launch ($LP)" || bad "portkey.js not written"
ping_page vp=1x1 >/dev/null; sleep 2
# a request without the key: answered (nc always says ok) but nothing happens
ping_nokey "snooze=62&rid=9001" >/dev/null; sleep 3
grep -q 'staying awake 62s' "$HUB_DIR/power.log" && bad "request WITHOUT the key was acted on" || ok "request without the key ignored"
grep -q 'without the right key was ignored' "$HUB_DIR/power.log" && ok "the ignored request was logged" || bad "ignored request not logged"
# a wrong key
for i in 1 2 3 4 5; do R=$(busybox wget -q -T 2 -O- "http://127.0.0.1:8765/save?snooze=63&rid=9002&pk=00000000000000000000000000000000&t=$(date +%s%N)" 2>/dev/null); [ "$R" = ok ] && break; sleep 1; done; sleep 3
grep -q 'staying awake 63s' "$HUB_DIR/power.log" && bad "request with a WRONG key was acted on" || ok "wrong key ignored"
# with the key: works
ping_page "snooze=64&rid=9003" >/dev/null; sleep 3
grep -q 'staying awake 64s' "$HUB_DIR/power.log" && ok "request with the key handled" || bad "keyed request not handled"
# a relaunch keeps the same key (the open page would otherwise be locked out)
echo test > "$HUB_DIR/.relaunch"; OL=$(cat $HUB_DIR/.loop.pid)
waitfor '[ -n "$(cat $HUB_DIR/.loop.pid 2>/dev/null)" ] && [ "$(cat $HUB_DIR/.loop.pid)" != "$OL" ]' 40; sleep 3
[ "$(cat "$HUB_DIR/.port_key")" = "$K" ] && ok "relaunch kept the same key" || bad "relaunch changed the key"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
echo "--- power.log tail"; tail -6 "$HUB_DIR/power.log"
