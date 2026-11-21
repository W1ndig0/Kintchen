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
for J in v109.js v1010.js; do [ -s "shiftcal/mesquite/$J" ] || { echo "MISSING: mesquite/$J"; FAIL=1; }; done
for J in shiftcal/mesquite/v109.js shiftcal/mesquite/v1010.js shiftcal/mesquite/qr.js; do npx --yes acorn@8.14.0 --ecma5 --silent "$J" || { echo "NOT ES5: $J"; FAIL=1; }; done
# 10.9.3: start-up code must not read a variable that is only set further down the page (what broke 10.9-10.9.2:
# blank screen + rollback). The names in KH_SCAN_KNOWN already did this in 10.8 and are guarded at run time.
python3 page_lines.py > /tmp/page_lines.js || FAIL=1
if ! node -e 'require("acorn"); require("acorn-walk")' 2>/dev/null; then
    mkdir -p /tmp/kh-scan && (cd /tmp/kh-scan && npm install --silent --no-save acorn@8.14.0 acorn-walk@8.3.4 >/dev/null 2>&1)
    export NODE_PATH=/tmp/kh-scan/node_modules
fi
KH_SCAN_KNOWN="AISLES AUTO CAL2_OFF DAY DAYPARTS EVENTS FEEL FEEL8 HORO H_COL H_END H_MID H_OPEN PAGE PEEKED PEOPLE RAIL TOUR TOUR_I ZODIAC" \
    node startup_scan.js /tmp/page_lines.js shiftcal/mesquite/v109.js shiftcal/mesquite/v1010.js || { echo "START-UP CODE READS SOMETHING BEFORE IT IS SET (the page would not start)"; FAIL=1; }
# 10.10.4: every "if has a b c" block in the loop must name every setting read inside it, or that setting
# would silently stop working. Checked here so the guards can never drift from the code they guard.
python3 - <<'PYCHK' || { echo "A SETTING INSIDE AN 'if has' BLOCK IS NOT NAMED IN ITS GUARD"; FAIL=1; }
import re, sys
L = open("shiftcal/power_loop.sh").read().split("\n")
bad = []
for i, line in enumerate(L):
    m = re.match(r"    if has ([\w ]+); then", line)      # the guards sit at four spaces, their body at eight
    if not m:
        continue
    keys = set(m.group(1).split())
    for j in range(i + 1, len(L)):
        if L[j] == "    fi":
            break
        for k in re.findall(r"qv (\w+)", L[j]):
            if k not in keys:
                bad.append("   line %d reads '%s' but the guard on line %d does not name it" % (j + 1, k, i + 1))
    else:
        bad.append("   the guard on line %d is never closed" % (i + 1))
for b in bad:
    print(b)
sys.exit(1 if bad else 0)
PYCHK
[ "$FAIL" = "0" ] && echo "   ok - every guarded setting is named in its guard"
[ "$FAIL" = "0" ] && echo "build check passed" || { echo "build check FAILED - manifest not updated"; exit 1; }
