#!/bin/sh
# Kitchen Hub 10.2 web reader: fetch one page for the hub's browser.
#   web_fetch.sh "https://text.npr.org/"     a page
#   web_fetch.sh "q:prince george weather"    a web search (DuckDuckGo Lite)
# Writes mesquite/web.js: window.HUB_WEB = {id, url, final, code, err, ts, html:"..."}; the page turns the
# HTML into clean text with numbered links (it never runs the site's scripts or loads its pictures).
DIR=${HUB_DIR:-/mnt/us/extensions/shiftcal}
MESQ="$DIR/mesquite"; OUT="$MESQ/web.js"; T="$DIR/.web"
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
[ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"; command -v kcurl >/dev/null 2>&1 || kcurl() { "$CURL" "$@"; }     # 10.5: never unchecked when kcurl.sh is missing
mkdir -p "$T"
if [ "$1" = "save" ]; then      # 10.3: web_fetch.sh save "Name" -> the last page as text in the Kindle library
    LIB="${HUB_LIB:-/mnt/us/documents/Kitchen Hub}/Web pages"
    [ -s "$T/last.html" ] || { echo "save: no page to save"; exit 1; }
    mkdir -p "$LIB"; NAME=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9 ._()-' | cut -c1-80); [ -n "$NAME" ] || NAME="Web page"
    { echo "$NAME"; echo "$(cat "$T/last.url" 2>/dev/null)"; echo "Saved $(date '+%Y-%m-%d') by Kitchen Hub"; echo
      tr '\n\r\t' '   ' < "$T/last.html" | awk 'BEGIN { RS = "<"; skip = 0; out = "" }
        NR == 1 { next }
        { tag = tolower($0); cl = substr(tag, 1, 1) == "/"; if (cl) tag = substr(tag, 2); sub(/[ >\/].*/, "", tag); if (cl) tag = "/" tag; t = $0; sub(/^[^>]*>/, "", t)
          if (tag == "script" || tag == "style" || tag == "noscript" || tag == "nav" || tag == "footer" || tag == "header") skip++
          else if ((tag == "/script" || tag == "/style" || tag == "/noscript" || tag == "/nav" || tag == "/footer" || tag == "/header") && skip > 0) skip--
          if (tag ~ /^\/?(p|div|br|li|h[1-6]|tr|blockquote|pre|section|article)$/) printf "\n"
          if (!skip) { gsub(/&nbsp;/, " ", t); gsub(/&lt;/, "<", t); gsub(/&gt;/, ">", t); gsub(/&quot;/, "\"", t); gsub(/&#39;|&#039;|&apos;/, "\047", t); gsub(/&amp;/, "\\&", t); gsub(/  +/, " ", t); printf "%s", t } }' \
      | sed 's/^ *//; s/ *$//' | awk 'NF { blank = 0; print; next } !blank++ { print }'
    } > "$LIB/$NAME.txt.tmp" && mv "$LIB/$NAME.txt.tmp" "$LIB/$NAME.txt" || { echo "save: could not write the file"; exit 1; }
    echo "saved a web page to the Kindle library: $NAME.txt"; exit 0
fi
U="$1"; ID=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9' | cut -c1-20)
case "$U" in
    q:*) Q=$(printf '%s' "${U#q:}" | sed 's/%/%25/g; s/ /+/g; s/&/%26/g; s/#/%23/g; s/?/%3F/g; s/=/%3D/g'); U="${WEB_SEARCH:-https://lite.duckduckgo.com/lite/}?q=$Q" ;;
    http://*|https://*) ;;
    *) U="https://$U" ;;
esac
ESCU=$(printf '%s' "$U" | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-600)
CODE=$(kcurl -sL --max-filesize 3000000 --max-redirs 6 --connect-timeout 8 --max-time 25 -A "Mozilla/5.0 (X11; Linux armv7l) KitchenHub/10.3" \
       -H "Accept-Language: en-CA,en;q=0.8" -o "$T/page" -w '%{http_code} %{url_effective}' "$U" 2>/dev/null)
FINAL=$(printf '%s' "$CODE" | cut -d' ' -f2- | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-600); CODE=$(printf '%s' "$CODE" | cut -d' ' -f1)
ERR=""
[ -s "$T/page" ] || ERR="No answer from the site (no Wi-Fi, or it refused)"
case "$CODE" in 2*) ;; 000) ERR="Couldn't reach the site" ;; *) [ -z "$ERR" ] && [ ! -s "$T/page" ] && ERR="The site said $CODE" ;; esac
{
    printf 'window.HUB_WEB={id:"%s",url:"%s",final:"%s",code:%s,err:"%s",ts:%s,html:"' "$ID" "$ESCU" "${FINAL:-$ESCU}" "${CODE:-0}" "$ERR" "$(date +%s)"
    # 700 KB is plenty of article; bigger pages are cut (the reader says so). JS-string safe: \ " CR, and U+2028/9.
    # 10.10.3: also drop the other control characters (the Kindle's engine can stop at one, like data.js did)
    # and any half character left by the byte-wise cut, so the file always parses.
    head -c 700000 "$T/page" 2>/dev/null | tr -d '\000-\010\013-\037' | sed "$(printf '$s/[\302-\364][\200-\277]*$//')" | awk 'BEGIN { ORS = "" } {
        gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\342\200\250|\342\200\251/, " "); print $0 "\\n" }'
    printf '"};\n'
} > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
case "$ID" in w*) mv -f "$T/page" "$T/last.html" 2>/dev/null; printf '%s\n' "$U" > "$T/last.url" ;; esac      # reader pages are kept for SAVE TO LIBRARY
rm -f "$T/page"
echo "web: ${CODE:-0} $(wc -c < "$OUT" 2>/dev/null | tr -d ' ') bytes"
