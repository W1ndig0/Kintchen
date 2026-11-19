. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
export FAKE_WIFI=CONNECTED
printf '#!/bin/sh\necho stub sync\n' > $HUB_DIR/sync_data.sh; printf '#!/bin/sh\nexit 0\n' > $HUB_DIR/hub_cloud.sh
SRV=$KT/site; mkdir -p $SRV/kindle; cp -r $HUB_DIR $SRV/kindle/shiftcal; cp $KH_TESTS/../kindle/make_manifest.sh $SRV/kindle/
rm -f $SRV/kindle/shiftcal/eco.conf; sh $SRV/kindle/make_manifest.sh >/dev/null
( cd $SRV && exec python3 -m http.server 8899 >/dev/null 2>&1 ) & HP=$!; sleep 1
echo 'PAGES_URL="http://127.0.0.1:8899/"' > $HUB_DIR/cloud.conf
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; ping_page vp=1x1 >/dev/null; sleep 3
L1=$(cat $HUB_DIR/.loop.pid)
ping_page "job=update-install&rid=501" >/dev/null; sleep 8
[ "$(cat $HUB_DIR/.loop.pid)" = "$L1" ] && [ "$(starts)" = 1 ] && grep -q 'update: nothing to install' $HUB_DIR/power.log && ok "install with nothing new: no restart" || bad "nothing-new path: loop $(cat $HUB_DIR/.loop.pid) vs $L1, starts=$(starts)"
sed -i 's/^VERSION="10.5"/VERSION="10.6"/' $SRV/kindle/shiftcal/power_loop.sh; sh $SRV/kindle/make_manifest.sh >/dev/null
ping_page "job=update-install&rid=502" >/dev/null
waitfor 'grep -q "rolled back the fresh update - launching again" $HUB_DIR/hub.log' 60
waitfor '[ "$(loops)" = 1 ]' 30; ping_page vp=1x1 >/dev/null; sleep 3
grep -q '^VERSION="10.5"' $HUB_DIR/power_loop.sh && [ "$(loops)" = 1 ] && [ "$(pages)" = 1 ] && [ "$(doubles)" = 0 ] && ok "half-installed 10.6: launcher undid it, 10.5 running (1 loop, 1 page)" || bad "loops=$(loops) pages=$(pages) doubles=$(doubles) ver=$(grep ^VERSION $HUB_DIR/power_loop.sh)"
[ "$(grep -c 'update installed - restarting' $HUB_DIR/power.log)" = 1 ] && ok "exactly one restart for the install" || bad "restarts: $(grep -c 'update installed - restarting' $HUB_DIR/power.log)"
grep -qx '10.6' $HUB_DIR/.update/bad && ok "10.6 marked bad (never auto-installed again)" || bad "not marked bad"
sh $HUB_DIR/stop_hub.sh >/dev/null 2>&1; kill $HP
echo "--- power.log"; grep -v 'woke early\|awake (' $HUB_DIR/power.log | tail -16; echo "--- hub.log"; grep -i 'fail\|roll\|launch' $HUB_DIR/hub.log
