. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
SRV=$KT/site; mkdir -p $SRV/kindle; cp -r $KH_TESTS/../kindle/shiftcal $SRV/kindle/; cp $KH_TESTS/../kindle/make_manifest.sh $SRV/kindle/
sed -i 's/^VERSION="10.5"/VERSION="10.6"/' $SRV/kindle/shiftcal/power_loop.sh; echo "# new" >> $SRV/kindle/shiftcal/web_fetch.sh
sh $SRV/kindle/make_manifest.sh >/dev/null
( cd $SRV && exec python3 -m http.server 8899 >/dev/null 2>&1 ) & HP=$!; sleep 1
echo 'PAGES_URL="http://127.0.0.1:8899/"' > $HUB_DIR/cloud.conf
U="sh $HUB_DIR/hub_update.sh"
$U check; [ $? = 2 ] && ok "check: exit 2 (nothing installed)" || bad "check rc"
$U install; RC=$?; [ $RC = 0 ] && [ -f $HUB_DIR/.update/pending ] && grep -q '^VERSION="10.6"' $HUB_DIR/power_loop.sh && ok "install: exit 0, 10.6 in place, on probation" || bad "install rc=$RC"
$U install; RC=$?; [ $RC = 2 ] && ok "install again (the old restart-loop trigger): exit 2, no restart" || bad "second install rc=$RC"
$U rollback; [ $? = 0 ] && grep -q '^VERSION="10.5"' $HUB_DIR/power_loop.sh && ok "rollback: back to 10.5, 10.6 marked bad" || bad rollback
$U auto; RC=$?; [ $RC = 2 ] && grep -q '^VERSION="10.5"' $HUB_DIR/power_loop.sh && ok "auto: skips the rolled-back 10.6 (exit 2)" || bad "auto rc=$RC"
rm -f $HUB_DIR/.update/bad; echo "tampered" >> $SRV/kindle/shiftcal/web_fetch.sh
B=$(sha256sum $HUB_DIR/web_fetch.sh); $U install; RC=$?
[ $RC = 1 ] && [ "$(sha256sum $HUB_DIR/web_fetch.sh)" = "$B" ] && ok "tampered download: exit 1, nothing changed" || bad "tampered rc=$RC"
kill $HP; tail -8 $HUB_DIR/sync.log
