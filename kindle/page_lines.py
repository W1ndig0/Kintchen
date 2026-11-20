# the page's inline scripts as one file, with every line number kept (for startup_scan.js messages)
import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else "shiftcal/mesquite/index.html"
s = open(p, encoding="utf-8").read(); out = []; pos = 0
for m in re.finditer(r"(<script(?![^>]*src)[^>]*>)(.*?)(</script>)", s, re.S):
    out.append(re.sub(r"[^\n]", "", s[pos:m.start(2)])); out.append(m.group(2)); pos = m.end(2)
out.append(re.sub(r"[^\n]", "", s[pos:])); sys.stdout.write("".join(out))
