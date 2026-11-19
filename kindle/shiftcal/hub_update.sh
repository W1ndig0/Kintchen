#!/bin/sh
# Kitchen Hub self-update from your GitHub Pages site (no USB cable needed).
#   hub_update.sh check     compare kindle/manifest.txt on your site with this install -> mesquite/update.js
#   hub_update.sh install   download changed files, verify every checksum, then swap them in all at once
#   hub_update.sh auto      (10.2) check, and install if there's a new version that hasn't been rolled back before
#   hub_update.sh rollback  (10.2) put back the files the last update replaced (kept in .update/backup)
#   hub_update.sh health V  (10.2) the page says version V started fine: the update is kept
# After an install the new version is "on probation" (.update/pending) until the page reports in; power_loop
# rolls it back by itself if it doesn't (a broken page, a script that won't start).
# Your settings and lists (cloud.conf, eco.conf, hub.tsv, stocks.conf, news.conf) are never in the manifest.
# Needs Wi-Fi on (power_loop runs it inside its network job).
# 10.5 exit codes: 0 = a new version was installed (restart the hub), 2 = nothing installed (up to date,
#   only checked, or skipped), 1 = error. Before 10.5 "up to date" also returned 0, and the loop read that as
#   "installed - restarting the hub": a second tap on INSTALL restarted the hub over and over.
DIR=${HUB_DIR:-/mnt/us/extensions/shiftcal}
LOG=$DIR/sync.log
ST=$DIR/.update
JS=$DIR/mesquite/update.js
PAGES_URL=""
[ -f "$DIR/cloud.conf" ] && . "$DIR/cloud.conf"
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
KC_STRICT=1      # 10.5: update code is never downloaded without a certificate check
[ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"
command -v kcurl >/dev/null 2>&1 || { state() { :; }; echo "$(date '+%m-%d %H:%M:%S') [update] kcurl.sh missing - refusing to download" >> "$LOG"; exit 1; }
say() { echo "$(date '+%m-%d %H:%M:%S') [update] $*" >> "$LOG"; }
state() {   # $1 state  $2 new version  $3 files to fetch  $4 message
    CUR=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$DIR/power_loop.sh" | head -1)
    M=$(printf '%s' "$4" | sed 's/["\\]//g')
    echo "window.HUB_UPDATE={state:\"$1\",cur:\"$CUR\",nv:\"$2\",files:${3:-0},msg:\"$M\",ts:$(date +%s)};" > "$JS.tmp" && mv "$JS.tmp" "$JS"
}
# github.com/you/repo -> https://you.github.io/repo/
BASE=$(printf '%s' "$PAGES_URL" | sed -e 's#^\(https*://\)*github\.com/\([^/]*\)/\([^/]*\).*#https://\2.github.io/\3/#' -e 's#/*$#/#')
BASE="${BASE}kindle"
SUM=""; command -v sha256sum >/dev/null 2>&1 && SUM=sha256
[ -z "$SUM" ] && command -v md5sum >/dev/null 2>&1 && SUM=md5
[ -z "$SUM" ] && { state error "" 0 "no checksum tool on this Kindle"; exit 1; }
hashof() { if [ "$SUM" = sha256 ]; then sha256sum "$1" | cut -c1-64; else md5sum "$1" | cut -c1-32; fi; }
want() { if [ "$SUM" = sha256 ]; then echo "$1"; else echo "$2"; fi; }

mkdir -p "$ST"
CUR=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$DIR/power_loop.sh" | head -1)
event() { echo "$(date +%s) $*" > "$ST/event"; }
if [ "$1" = "health" ]; then
    [ -f "$ST/pending" ] || exit 0
    PV=$(cut -d' ' -f1 "$ST/pending")
    [ "$2" = "$PV" ] || exit 0
    rm -f "$ST/pending"; event "healthy $PV"; say "update $PV started fine - keeping it"; state installed "$PV" 0 "$PV is running fine"; exit 0
fi
if [ "$1" = "rollback" ]; then
    [ -d "$ST/backup/files" ] || [ -s "$ST/backup/added" ] || { state error "" 0 "Nothing to go back to (no earlier version saved)"; say "rollback: no backup"; exit 1; }
    PV=$(cat "$ST/backup/VERSION" 2>/dev/null)
    FAILCP=""
    ( cd "$ST/backup/files" 2>/dev/null && find . -type f ) | sed 's#^\./##' > "$ST/rb.list"
    while read -r F; do [ -n "$F" ] || continue; cp "$ST/backup/files/$F" "$DIR/$F.old" 2>/dev/null || { FAILCP="$F"; break; }; done < "$ST/rb.list"
    if [ -n "$FAILCP" ]; then while read -r F; do rm -f "$DIR/$F.old"; done < "$ST/rb.list"; state error "$PV" 0 "Could not restore $FAILCP - nothing was changed"; exit 1; fi
    while read -r F; do [ -n "$F" ] && mv "$DIR/$F.old" "$DIR/$F"; done < "$ST/rb.list"
    [ -s "$ST/backup/added" ] && while read -r F; do case "$F" in ""|*..*|/*) ;; *) rm -f "$DIR/$F" ;; esac; done < "$ST/backup/added"
    chmod +x "$DIR"/*.sh 2>/dev/null
    echo "$CUR" >> "$ST/bad"                         # don't auto-install the version that just failed again
    rm -f "$ST/pending" "$ST/rb.list"; rm -rf "$ST/backup"
    event "rolledback $CUR $PV"; say "rolled back $CUR -> $PV"
    state rolledback "$PV" 0 "Went back to $PV (from $CUR)"; exit 0
fi
case "$BASE" in https://*|http://127.0.0.1*) ;; *) state error "" 0 "PAGES_URL is not set in cloud.conf"; exit 1 ;; esac
C=$(kcurl -s --connect-timeout 8 --max-time 25 -o "$ST/manifest.txt" -w '%{http_code}' "$BASE/manifest.txt?t=$(date +%s)" 2>/dev/null)
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
if [ "$1" = "auto" ] && [ "$N" != "0" ] && grep -qx "$NV" "$ST/bad" 2>/dev/null; then
    state available "$NV" "$N" "$NV was rolled back before - install it by hand if you want it"; say "auto: $NV is marked bad, skipping"; exit 2
fi
[ -n "$NV" ] || { state error "" 0 "the manifest on your site has no version"; say "manifest without a version"; exit 1; }
# 10.6: never go backwards by "update" (GO BACK TO THE PREVIOUS VERSION is the way back). 1 if $1 is older than $2.
older() { awk -v a="$1" -v b="$2" 'BEGIN { n = split(a, x, "."); m = split(b, y, "."); k = n > m ? n : m
    for (i = 1; i <= k; i++) { p = x[i] + 0; q = y[i] + 0; if (p < q) { print 1; exit } if (p > q) { print 0; exit } } print 0 }'; }
if [ "$N" != "0" ] && [ -n "$CUR" ] && [ "$(older "$NV" "$CUR")" = "1" ]; then
    state current "$NV" 0 "Your site has $NV, older than the $CUR on the fridge - upload the newer kit to GitHub"
    say "site has $NV, older than $CUR - not installing"; exit 2
fi
if [ "$1" = "check" ] || [ "$N" = "0" ]; then
    if [ "$N" = "0" ]; then state current "$NV" 0 "Up to date"; say "up to date ($NV)"
    else state available "$NV" "$N" "$N files to update"; say "update available: $NV, $N files"; fi
    exit 2      # 10.5: nothing was installed
fi
# install: everything into a staging folder first; nothing changes unless every file checks out
rm -rf "$ST/files"; mkdir -p "$ST/files"
state downloading "$NV" "$N" "Downloading $N files"
BAD=""
while read -r S M Z F; do
    mkdir -p "$ST/files/$(dirname "$F")"
    U=$(printf '%s' "$F" | sed 's/ /%20/g')
    C=$(kcurl -s --connect-timeout 8 --max-time 60 -o "$ST/files/$F" -w '%{http_code}' "$BASE/shiftcal/$U?t=$(date +%s)" 2>/dev/null)
    if [ "$C" != "200" ] || [ "$(hashof "$ST/files/$F")" != "$(want "$S" "$M")" ]; then BAD="$F ($C)"; break; fi
done < "$ST/todo"
if [ -n "$BAD" ]; then state error "$NV" "$N" "Download failed: $BAD - nothing was changed"; say "install aborted at $BAD"; rm -rf "$ST/files"; exit 1; fi
# 10.2: keep what we're about to replace, so the update can be undone
rm -rf "$ST/backup.new"; mkdir -p "$ST/backup.new/files"; echo "$CUR" > "$ST/backup.new/VERSION"; : > "$ST/backup.new/added"; BK=""
while read -r S M Z F; do
    if [ -f "$DIR/$F" ]; then mkdir -p "$ST/backup.new/files/$(dirname "$F")"; cp "$DIR/$F" "$ST/backup.new/files/$F" 2>/dev/null || { BK="$F"; break; }
    else echo "$F" >> "$ST/backup.new/added"; fi
done < "$ST/todo"
if [ -n "$BK" ]; then rm -rf "$ST/backup.new" "$ST/files"; state error "$NV" "$N" "Could not save a backup of $BK (storage full?) - nothing was changed"; say "install aborted: no room for the backup"; exit 1; fi
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
# 10.5: every rename is checked. If one fails, the files already swapped are put back from the backup.
FAILMV=""; : > "$ST/swapped"
while read -r S M Z F; do
    if mv "$DIR/$F.new" "$DIR/$F" 2>/dev/null; then echo "$F" >> "$ST/swapped"; else FAILMV="$F"; break; fi
done < "$ST/todo"
if [ -n "$FAILMV" ]; then
    while read -r F; do
        if [ -f "$ST/backup.new/files/$F" ]; then cp "$ST/backup.new/files/$F" "$DIR/$F" 2>/dev/null; else rm -f "$DIR/$F"; fi
    done < "$ST/swapped"
    while read -r S M Z F; do rm -f "$DIR/$F.new"; done < "$ST/todo"
    rm -rf "$ST/files" "$ST/backup.new" "$ST/swapped"
    state error "$NV" "$N" "Could not put $FAILMV in place - the old version was kept"; say "install aborted renaming $FAILMV - old files restored"; exit 1
fi
rm -f "$ST/swapped"
chmod +x "$DIR"/*.sh 2>/dev/null
rm -rf "$ST/files" "$ST/backup"; mv "$ST/backup.new" "$ST/backup"
echo "$NV $CUR $(date +%s) 0" > "$ST/pending"; event "installed $CUR $NV"
state installed "$NV" "$N" "Installed $NV - restarting the hub"
say "installed $NV ($N files)"
exit 0
