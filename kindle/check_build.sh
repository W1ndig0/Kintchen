#!/bin/sh
# 10.2: run by GitHub before the fridge is told about a new version. If anything here fails, the manifest
# is NOT rebuilt, so the fridge keeps the version it has (and you get a red X on the Actions tab).
cd "$(dirname "$0")" || exit 1
FAIL=0
for S in shiftcal/*.sh; do sh -n "$S" || { echo "BROKEN SCRIPT: $S"; FAIL=1; }; done
grep -q '^VERSION="[0-9][0-9.a-z-]*"' shiftcal/power_loop.sh || { echo "power_loop.sh has no VERSION"; FAIL=1; }
python3 - <<'PY' > /tmp/page.js || FAIL=1
import re, sys
s = open("shiftcal/mesquite/index.html", encoding="utf-8").read()
parts = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", s, re.S)
if not parts or sum(len(p) for p in parts) < 100000: sys.exit("page script missing or too small")
print("\n".join(parts))
PY
npx --yes acorn@8.14.0 --ecma5 --silent /tmp/page.js || { echo "PAGE SCRIPT DOES NOT PARSE (old Kindle browser = ES5 only)"; FAIL=1; }
[ "$FAIL" = "0" ] && echo "build check passed" || { echo "build check FAILED - manifest not updated"; exit 1; }
