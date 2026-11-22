# 11.2: the fridge side of the PC features (layout from the PC, price check button, pairing button, settings backup).
# Run: KH_TESTS=$(pwd) sh t30.sh   (about 20 seconds). Needs phantomjs.
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d /tmp/kh30.XXXXXX)
PATH="$PATH:/opt/npm-tools/node_modules/.bin"; command -v phantomjs >/dev/null || { echo "FAIL no phantomjs"; exit 1; }
cp -r "$R/kindle/shiftcal/mesquite" "$T/mq" && node "$R/tests/page/make_fixture.js" "$T/mq" 3 >/dev/null
echo 'window.HUB_CLOUD={pc:"http://192.168.1.20:8770",pages:"",gist:"",token:"",pass:"",pass0:"",legacy:0,mon:"",cok:1,keysAt:0,wake:1,ntfy:"",alerts:1,cdata:1,cdataAt:0,ics:"",ics2:"",tv:"",cgist:"",brainAt:0};' > "$T/mq/cloud.js"
N=$(date +%s)000
node -e '
const H = require(process.argv[1] + "/cloud/hubdata.js"), n = +process.argv[3];
const L = [H.makeLine(n - 9000, "s1", "shop", "open", "Milk"), H.makeLine(n - 8000, "s2", "shop", "open", "Eggs"),
           H.makeLine(n - 5000, "cfgpc", "cfg", "open", JSON.stringify({ at: n, keys: { pg_rot6: "90" } })),
           H.makeLine(n - 4000, "pricecheck", "pc", "open", "Cheapest: Walmart $42.10. Superstore $43.00")];
require("fs").writeFileSync(process.argv[2] + "/hub_items.js", "window.HUB_ITEMS = { st: \"ok\", pending: 0, at: 1, lines: [" + L.map(l => JSON.stringify(l)).join(",") + ",\"\"] };\n");
' "$R" "$T/mq" "$N"
OPENSSL_CONF=/dev/null timeout 90 phantomjs --local-to-remote-url-access=yes --web-security=no "$R/tests/page/v11_features.phantom.js" "$T/mq" 2>&1 | grep -v 'libpng'
rm -rf "$T"
