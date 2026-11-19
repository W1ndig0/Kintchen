# Builds mesquite/whatsnew.js from UPDATE_<v>.txt: headings, numbered items (continuation lines joined). python3 tests/whatsnew_gen.py 10.7
import json, re, sys, os
v = sys.argv[1]; root = os.path.join(os.path.dirname(__file__), "..")
lines, cur = [], None
for raw in open(os.path.join(root, "UPDATE_%s.txt" % v), encoding="utf-8").read().splitlines()[3:]:
    if not raw.strip(): cur = None; continue
    m = re.match(r"^ ?(\d{1,2})  (\S.*)$", raw)
    if m: lines.append(m.group(1) + "  " + m.group(2).strip()); cur = len(lines) - 1; continue
    if raw.startswith("    ") and cur is not None: lines[cur] += " " + raw.strip(); continue
    lines.append(raw.strip()); cur = None
open(os.path.join(root, "kindle/shiftcal/mesquite/whatsnew.js"), "w", encoding="utf-8").write("window.HUB_WHATSNEW = " + json.dumps({"v": v, "lines": lines}, ensure_ascii=False) + ";\n")
print("\n".join(lines))
