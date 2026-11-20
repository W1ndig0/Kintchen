# 10.9.2: by default the hub never touches the frontlight (10.9 turned it off at every start and wake), and
# the old 10.9 FRONTLIGHT=0 setting is ignored. Run: KH_TESTS=$(pwd) sh t20.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nCLOUD_ON_WAKE=0\nAUTO_UPDATE=0\nFRONTLIGHT=0\n' > "$HUB_DIR/eco.conf"
: > "$KT/light.log"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_page "boot=t20" >/dev/null; sleep 12
[ -s "$KT/light.log" ] && bad "the light was changed: $(tr '\n' ' ' < "$KT/light.log")" || ok "light left alone at start, wake and standby"
grep -q 'frontlight: -1' "$HUB_DIR/mesquite/state.js" && ok "page told: the Kindle's own light" || bad "state.js: $(grep -o 'frontlight: [^,]*' "$HUB_DIR/mesquite/state.js")"
ping_page "light=12" >/dev/null; sleep 2
grep -q 'light 12' "$KT/light.log" && ok "a chosen level is used" || bad "chosen level not used"
ping_page "light=keep" >/dev/null; sleep 2
grep -q '^LIGHT_AWAKE=keep' "$HUB_DIR/eco.conf" && ok "back to the Kindle's own light" || bad "keep not saved: $(grep LIGHT "$HUB_DIR/eco.conf")"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
