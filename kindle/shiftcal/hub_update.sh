#!/bin/sh
# Kitchen Hub self-update from your GitHub Pages site (no USB cable needed).
#   hub_update.sh check     compare kindle/manifest.txt on your site with this install -> mesquite/update.js
#   hub_update.sh install   download changed files, verify every checksum, then swap them in all at once
# Your settings and lists (cloud.conf, eco.conf, hub.tsv, stocks.conf, news.conf) are never in the manifest.
# Needs Wi-Fi on (power_loop runs it inside its network job).
DIR=${HUB_DIR:-/mnt/us/extensions/shiftcal}
LOG=$DIR/sync.log
ST=$DIR/.update
JS=$DIR/mesquite/update.js
PAGES_URL=""
[ -f "$DIR/cloud.conf" ] && . "$DIR/cloud.conf"
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
say() { echo "$(date '+%m-%d %H:%M:%S') [update] $*" >> "$LOG"; }
state() {   # $1 state  $2 new version  $3 files to fetch  $4 message
    CUR=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$DIR/power_loop.sh" | head -1)
    M=$(printf '%s' "$4" | sed 's/["\\]//g')
    echo "window.HUB_UPDATE={state:\"$1\",cur:\"$CUR\",nv:\"$2\",files:${3:-0},msg:\"$M\",ts:$(date +%s)};" > "$JS.tmp" && mv "$JS.tmp" "$JS"
}
# github.com/you/repo -> https://you.github.io/repo/
BASE=$(printf '%s' "$PAGES_URL" | sed -e 's#^\(https*://\)*github\.com/\([^/]*\)/\([^/]*\).*#https://\2.github.io/\3/#' -e 's#/*$#/#')
case "$BASE" in https://*|http://127.0.0.1*) ;; *) state error "" 0 "PAGES_URL is not set in cloud.conf"; exit 1 ;; esac
BASE="${BASE}kindle"
SUM=""; command -v sha256sum >/dev/null 2>&1 && SUM=sha256
[ -z "$SUM" ] && command -v md5sum >/dev/null 2>&1 && SUM=md5
[ -z "$SUM" ] && { state error "" 0 "no checksum tool on this Kindle"; exit 1; }
hashof() { if [ "$SUM" = sha256 ]; then sha256sum "$1" | cut -c1-64; else md5sum "$1" | cut -c1-32; fi; }
want() { if [ "$SUM" = sha256 ]; then echo "$1"; else echo "$2"; fi; }

mkdir -p "$ST"
C=$($CURL -sk --connect-timeout 8 --max-time 25 -o "$ST/manifest.txt" -w '%{http_code}' "$BASE/manifest.txt?t=$(date +%s)" 2>/dev/null)
[ "$C" = "200" ] && head -1 "$ST/manifest.txt" | grep -q '^version ' || { state error "" 0 "no manifest on your site ($C) - upload the kindle folder from the GitHub kit"; say "no manifest ($C)"; exit 1; }
NV=$(sed -n '1s/^version //p' "$ST/manifest.txt" | tr -cd 'A-Za-z0-9.-')
# which files differ from what is installed now
: > "$ST/todo"
tail -n +2 "$ST/manifest.txt" | while read -r S M Z F; do
    case "$F" in ""|*..*|/*) continue ;; esac
    case "$F" in cloud.conf|eco.conf|hub.tsv|stocks.conf|news.conf) continue ;; esac
    [ -f "$DIR/$F" ] && [ "$(hashof "$DIR/$F")" = "$(want "$S" "$M")" ] && continue
    echo "$S $M $Z $F" >> "$ST/todo"
done
N=$(grep -c . "$ST/todo")
if [ "$1" = "check" ] || [ "$N" = "0" ]; then
    if [ "$N" = "0" ]; then state current "$NV" 0 "Up to date"; say "up to date ($NV)"
    else state available "$NV" "$N" "$N files to update"; say "update available: $NV, $N files"; fi
    exit 0
fi
# install: everything into a staging folder first; nothing changes unless every file checks out
rm -rf "$ST/files"; mkdir -p "$ST/files"
state downloading "$NV" "$N" "Downloading $N files"
BAD=""
while read -r S M Z F; do
    mkdir -p "$ST/files/$(dirname "$F")"
    U=$(printf '%s' "$F" | sed 's/ /%20/g')
    C=$($CURL -sk --connect-timeout 8 --max-time 60 -o "$ST/files/$F" -w '%{http_code}' "$BASE/shiftcal/$U?t=$(date +%s)" 2>/dev/null)
    if [ "$C" != "200" ] || [ "$(hashof "$ST/files/$F")" != "$(want "$S" "$M")" ]; then BAD="$F ($C)"; break; fi
done < "$ST/todo"
if [ -n "$BAD" ]; then state error "$NV" "$N" "Download failed: $BAD - nothing was changed"; say "install aborted at $BAD"; rm -rf "$ST/files"; exit 1; fi
# swap: copy beside the old file, then rename (a running script keeps reading its old copy safely)
# 10.1.2: two steps - every copy first (and checked), then every rename - so a full disk can't leave half old, half new
FAILCP=""
while read -r S M Z F; do
    mkdir -p "$DIR/$(dirname "$F")"
    if ! cp "$ST/files/$F" "$DIR/$F.new" 2>/dev/null || [ "$(hashof "$DIR/$F.new")" != "$(want "$S" "$M")" ]; then FAILCP="$F"; break; fi
done < "$ST/todo"
if [ -n "$FAILCP" ]; then
    while read -r S M Z F; do rm -f "$DIR/$F.new"; done < "$ST/todo"
    rm -rf "$ST/files"; state error "$NV" "$N" "Could not copy $FAILCP (Kindle storage full?) - nothing was changed"; say "install aborted copying $FAILCP"; exit 1
fi
while read -r S M Z F; do mv "$DIR/$F.new" "$DIR/$F"; done < "$ST/todo"
chmod +x "$DIR"/*.sh 2>/dev/null
rm -rf "$ST/files"
state installed "$NV" "$N" "Installed $NV - restarting the hub"
say "installed $NV ($N files)"
exit 0
