# 10.9.4: when the page reports "Parse error @ data.js:N", the loop describes line N in the log once (length,
# invisible line separators, control characters, start and end). Run: KH_TESTS=$(pwd) sh t21.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export HUB_BOOT_WAIT=60
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
printf 'window.HUB_DATA = {\n    ts: 1,\n    updated: "1:00 PM",\n    wx: null,\n    articles: [{"t":"Mayor\342\200\250says\013yes"}],\n    stocks: []\n};\n' > "$HUB_DIR/mesquite/data.js"
ping_nokey "pgerr=SyntaxError%3A%20Parse%20error%20%40%20data.js%3A5%20%5Bhead%5D" >/dev/null; sleep 3
ping_nokey "pgerr=SyntaxError%3A%20Parse%20error%20%40%20data.js%3A5%20%5Bhead%5D" >/dev/null; sleep 3
grep -q 'data.js line 5: [0-9]* bytes, 7 lines in all, line separators: 1, control chars: 1' "$HUB_DIR/power.log" && ok "line described" || bad "no description: $(grep 'data.js' "$HUB_DIR/power.log" | tail -3)"
grep -q 'data.js line 5 starts:     articles: \[' "$HUB_DIR/power.log" && ok "start of the line shown" || bad "start missing"
[ "$(grep -c 'data.js line 5: ' "$HUB_DIR/power.log")" = 1 ] && ok "only once per start" || bad "described more than once"
[ "$(loops)" = 1 ] && ok "hub still running" || bad "loop gone"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
