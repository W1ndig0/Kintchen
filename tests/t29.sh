# 11.1: no GitHub left in the fridge page (Settings > PC / Updates / Security, Books), paired with the PC and not.
# Run: KH_TESTS=$(pwd) sh t29.sh   (about 20 seconds). Needs phantomjs.
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d /tmp/khnogh.XXXXXX)
PATH="$PATH:/opt/npm-tools/node_modules/.bin"; command -v phantomjs >/dev/null || { echo "FAIL no phantomjs"; exit 1; }
RC=0
for MODE in paired unpaired; do
    rm -rf "$T/mq"; cp -r "$R/kindle/shiftcal/mesquite" "$T/mq" && node "$R/tests/page/make_fixture.js" "$T/mq" 3 >/dev/null
    if [ "$MODE" = paired ]; then PC="http://192.168.1.20:8770"; ICS="http://192.168.1.20:8770/cal/abc/calendar.ics"; else PC=""; ICS=""; fi
    echo "window.HUB_CLOUD={pc:\"$PC\",pages:\"\",gist:\"\",token:\"\",pass:\"\",pass0:\"\",legacy:0,mon:\"\",cok:1,keysAt:0,wake:1,ntfy:\"kitchenhub-x\",alerts:1,cdata:1,cdataAt:0,ics:\"$ICS\",ics2:\"\",tv:\"\",cgist:\"\",brainAt:0};" > "$T/mq/cloud.js"
    OPENSSL_CONF=/dev/null timeout 90 phantomjs --local-to-remote-url-access=yes --web-security=no "$R/tests/page/no_github.phantom.js" "$T/mq" "$MODE" 2>&1 | grep -v 'libpng' || RC=1
done
rm -rf "$T"
