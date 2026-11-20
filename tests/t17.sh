# 10.9: kitchen monitor commands through the loop. Run: KH_TESTS=$(pwd) sh t17.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
printf 'PASSPHRASE=old-words-here\nGIST_ID=abc123\nGH_TOKEN=github_pat_OLDOLDOLDOLDOLDOLD\nPAGES_URL=https://x.github.io/k/\n' > "$HUB_DIR/cloud.conf"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null; sleep 2
grep -q '^MON_TOPIC=khscreen-[0-9a-f]\{20\}$' "$HUB_DIR/cloud.conf" && grep -q 'mon:"khscreen-' "$HUB_DIR/mesquite/cloud.js" && ok "monitor channel made and given to the page" || bad "no MON_TOPIC"
M1=$(sed -n 's/^MON_TOPIC=//p' "$HUB_DIR/cloud.conf")
ping_page "screen=~AbC-_123xyz&rid=601" >/dev/null; sleep 3
grep -q 'screen: no Wi-Fi\|screen: send failed' "$HUB_DIR/power.log" && ok "a locked command is passed on (test Kindle has no Wi-Fi)" || bad "screen command not handled: $(tail -3 "$HUB_DIR/power.log")"
N=$(grep -c 'screen:' "$HUB_DIR/power.log")
ping_page "screen=not-locked&rid=602" >/dev/null; ping_page "screen=~bad%24%28x%29&rid=603" >/dev/null; sleep 3
[ "$(grep -c 'screen:' "$HUB_DIR/power.log")" = "$N" ] && ok "unlocked or odd commands are dropped" || bad "odd command passed on"
echo test > "$HUB_DIR/.relaunch"; sleep 12
[ "$(sed -n 's/^MON_TOPIC=//p' "$HUB_DIR/cloud.conf")" = "$M1" ] && ok "the channel stays the same across restarts" || bad "channel changed"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
