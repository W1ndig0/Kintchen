#!/bin/sh
# 10.2: run by GitHub before the fridge is told about a new version. If anything here fails, the manifest
# is NOT rebuilt, so the fridge keeps the version it has (and you get a red X on the Actions tab).
cd "$(dirname "$0")" || exit 1
FAIL=0
for S in shiftcal/*.sh; do sh -n "$S" || { echo "BROKEN SCRIPT: $S"; FAIL=1; }; done
grep -q '^VERSION="[0-9][0-9.a-z-]*"' shiftcal/power_loop.sh || { echo "power_loop.sh has no VERSION"; FAIL=1; }
# 10.5: the page and the scripts must be the same version (a mismatch is refused by the launcher on the Kindle)
SV=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' shiftcal/power_loop.sh | head -1)
PV=$(sed -n 's/^var VERSION = "\([^"]*\)".*/\1/p' shiftcal/mesquite/index.html | head -1)
[ "$SV" = "$PV" ] || { echo "VERSION MISMATCH: scripts $SV, page $PV"; FAIL=1; }
# 10.5: files the launcher needs, and no Windows line endings in scripts or settings
for F in hub_common.sh kcurl.sh stop_hub.sh run_hub.sh register_mesquite.sh hub_update.sh cacert.pem; do [ -s "shiftcal/$F" ] || { echo "MISSING: $F"; FAIL=1; }; done
for S in shiftcal/*.sh shiftcal/*.conf; do grep -q "$(printf '\r')" "$S" && { echo "WINDOWS LINE ENDINGS: $S"; FAIL=1; }; done
grep -q 'BEGIN CERTIFICATE' shiftcal/cacert.pem || { echo "cacert.pem is not a certificate list"; FAIL=1; }
python3 - <<'PY' > /tmp/page.js || FAIL=1
import re, sys
s = open("shiftcal/mesquite/index.html", encoding="utf-8").read()
parts = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", s, re.S)
if not parts or sum(len(p) for p in parts) < 100000: sys.exit("page script missing or too small")
print("\n".join(parts))
PY
npx --yes acorn@8.14.0 --ecma5 --silent /tmp/page.js || { echo "PAGE SCRIPT DOES NOT PARSE (old Kindle browser = ES5 only)"; FAIL=1; }
# 10.9: the page's own script files (not the generated data files) must be ES5 too, and v109.js must be there
[ -s shiftcal/mesquite/v109.js ] || { echo "MISSING: mesquite/v109.js"; FAIL=1; }
for J in shiftcal/mesquite/v109.js shiftcal/mesquite/qr.js; do npx --yes acorn@8.14.0 --ecma5 --silent "$J" || { echo "NOT ES5: $J"; FAIL=1; }; done
[ "$FAIL" = "0" ] && echo "build check passed" || { echo "build check FAILED - manifest not updated"; exit 1; }
