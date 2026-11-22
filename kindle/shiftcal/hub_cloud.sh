#!/bin/sh
# Kitchen Hub cloud lists: exchanges hub.tsv with your private GitHub gist - or, v11, with the hub on your PC.
#   hub_cloud.sh sync          pull, merge, push if needed (needs Wi-Fi on). Prints nothing; see sync.log
#   hub_cloud.sh add LINE      store one edit made on the fridge (LINE url-encoded) and refresh the page
#   hub_cloud.sh js            rewrite mesquite/hub_items.js from hub.tsv
#   hub_cloud.sh status        upload kindle.json (battery, version, last sync) for the phone/TV/cloud brain
#   hub_cloud.sh log           upload the last lines of power.log + sync.log to your cloud gist (kindle-log.txt)
# 9.8.5: also picks up Siri/PC "inbox-*.txt" notes and the links the cloud brain leaves in kindle.conf
# cloud.conf:  GIST_ID=...  GH_TOKEN=...   (API= only for testing)
DIR=${HUB_DIR:-/mnt/us/extensions/shiftcal}
CONF=$DIR/cloud.conf
LOCAL=$DIR/hub.tsv              # the fridge's copy: always canonical
REMOTE=$DIR/.cloud_remote.tsv   # last copy seen on GitHub, canonicalised
ETAGF=$DIR/.cloud_etag
STF=$DIR/.cloud_status
T=$DIR/.cloud_tmp
JS=$DIR/mesquite/hub_items.js
LOG=$DIR/sync.log
TAB=$(printf '\t')
GIST_ID=""; GH_TOKEN=""; API="https://api.github.com"; PC_URL=""; PC_ID=""; PC_KEY=""
[ -f "$CONF" ] && . "$CONF"
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
KC_STRICT=1      # 10.5: your token and your books never go over an unchecked connection
[ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"; command -v kcurl >/dev/null 2>&1 || kcurl() { "$CURL" "$@"; }     # 10.5: never unchecked when kcurl.sh is missing
mkdir -p "$T" "$DIR/mesquite"
[ -f "$LOCAL" ] || echo "#hub v1" > "$LOCAL"

merge() { sh "$DIR/hub_merge.sh" "$@"; }
say() { echo "$(date '+%m-%d %H:%M:%S') [cloud] $*" >> "$LOG"; }
# 10.10.3: a stamp file cut off mid-write is not a number, and "$(( NOWS -  ))" ends the script (the lists
# sync would stop half way through).
num0() { V0=$(tr -cd '0-9' < "$1" 2>/dev/null | cut -c1-12); case "$V0" in '') echo 0 ;; *) echo "$V0" ;; esac; }
urldecode() { printf '%b' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/+/ /g' -e 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')"; }     # 10.5: a typed backslash stays a backslash

# hub.tsv is changed by "add" (from the page) while a sync may be running: every read-modify-write
# of it happens inside this short lock
llock() {     # 10.5: the lock is only broken when its owner is gone (or after 60 s), not after 8 s of waiting
    N=0
    while ! mkdir "$T/llock" 2>/dev/null; do
        N=$((N + 1))
        LP=$(cat "$T/llock/pid" 2>/dev/null | tr -cd '0-9')
        if { [ $N -ge 3 ] && [ -n "$LP" ] && ! kill -0 "$LP" 2>/dev/null; } || { [ $N -ge 3 ] && [ -z "$LP" ]; } || [ $N -ge 60 ]; then
            rm -rf "$T/llock"; N=0                                    # stale lock from a killed run
        fi
        sleep 1
    done
    echo $$ > "$T/llock/pid"
}
lunlock() { rm -rf "$T/llock"; }
merge_local() { llock; merge "$LOCAL" "$LOCAL" "$@"; lunlock; }

write_js() {
    ST=$(cat "$STF" 2>/dev/null); [ -n "$ST" ] || ST="never"
    PEND=0; [ -f "$REMOTE" ] && ! cmp -s "$LOCAL" "$REMOTE" && PEND=1
    [ -f "$REMOTE" ] || { [ "$(grep -c -v '^#' "$LOCAL")" != "0" ] && PEND=1; }
    {
        echo "window.HUB_ITEMS = { st: \"$ST\", pending: $PEND, at: $(date +%s), lines: ["
        grep -v '^#' "$LOCAL" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/^/"/' -e 's/$/",/'
        echo '""] };'
    } > "$JS.$$" && mv "$JS.$$" "$JS"
}

# api METHOD URL [curl args] -> prints the http code; body in $T/b.$$, headers in $T/h.$$
# 10.5: the token goes to curl from a private file in RAM (curl -H @file), not on the command line where
# any process list (ps, the diagnostics snapshot) could show it.
HDRF=""
hdr_file() {
    [ -n "$HDRF" ] && [ -s "$HDRF" ] && return 0
    HDRF="/tmp/khh.$$"; rm -f "$HDRF"
    ( umask 077; printf 'Authorization: Bearer %s\n' "$GH_TOKEN" > "$HDRF" )
}
trap 'rm -f "/tmp/khh.$$"' EXIT
api() {
    M=$1; U=$2; shift 2
    hdr_file
    kcurl -s --connect-timeout 8 --max-time 25 -X "$M" \
        -H "@$HDRF" -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" -H "User-Agent: KitchenHub" \
        -D "$T/h.$$" -o "$T/b.$$" -w '%{http_code}' "$@" "$U" 2>/dev/null
}
raw_url() { grep -o '"raw_url" *: *"[^"]*/hub\.tsv"' "$T/b.$$" | head -1 | sed 's/.*"\(http[^"]*\)"$/\1/'; }
fetch_raw() {   # $1 raw url -> canonical copy in $T/r.$$
    [ -n "$1" ] || return 1
    C=$(kcurl -s --connect-timeout 8 --max-time 25 -H "User-Agent: KitchenHub" -o "$T/raw.$$" -w '%{http_code}' "$1" 2>/dev/null)
    [ "$C" = "200" ] || return 1
    merge "$T/r.$$" "$T/raw.$$"      # canonical form: GitHub may store the text with other line endings
}
fail() { echo "$1" > "$STF"; say "$1"; write_js; exit 1; }

pull() {   # $1=1: allow 304 (cached copy is still current)
    if [ "$1" = "1" ] && [ -s "$ETAGF" ] && [ -f "$REMOTE" ]; then
        CODE=$(api GET "$API/gists/$GIST_ID" -H "If-None-Match: $(cat "$ETAGF")")
    else
        CODE=$(api GET "$API/gists/$GIST_ID")
    fi
    case "$CODE" in
        304) return 0 ;;
        200) U=$(raw_url)
             if [ -z "$U" ]; then echo "#hub v1" > "$T/r.$$"        # gist has no hub.tsv yet: it gets created
             else fetch_raw "$U" || fail "could not download the list file"; fi
             mv "$T/r.$$" "$REMOTE"
             tr -d '\r' < "$T/h.$$" | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p' | head -1 > "$ETAGF"
             save_links; take_inbox ;;
        401) fail "token rejected - make a new token" ;;
        403) grep -qi "rate limit" "$T/b.$$" && fail "GitHub rate limit - will retry" || fail "token not allowed to use this gist (403)" ;;
        404) fail "gist not found - check GIST_ID" ;;
        000) fail "offline (no answer from GitHub)" ;;
        *) fail "GitHub answered $CODE" ;;
    esac
}

push() {
    llock; cp "$LOCAL" "$T/up.$$"; lunlock                 # upload a snapshot: "add" may change hub.tsv meanwhile
    {
        printf '{"files":{'
        [ -s "$T/inbox_done" ] && sort -u "$T/inbox_done" | while read -r F; do printf '"%s":null,' "$F"; done
        printf '"hub.tsv":{"content":"'
        sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$TAB/\\\\t/g" "$T/up.$$" | awk '{ printf "%s\\n", $0 }'
        printf '"}}}'
    } > "$T/p.$$"
    CODE=$(api PATCH "$API/gists/$GIST_ID" -H "Content-Type: application/json" --data-binary "@$T/p.$$")
    case "$CODE" in
        200) ;;
        403|429) fail "GitHub is limiting uploads - will retry" ;;
        *) fail "upload refused (code $CODE)" ;;
    esac
    # the reply names the new revision: read it back to be sure GitHub stored what we sent
    fetch_raw "$(raw_url)" && cmp -s "$T/r.$$" "$T/up.$$" || fail "upload did not verify"
    mv "$T/r.$$" "$REMOTE"
    rm -f "$ETAGF" "$T/inbox_done"
}

# ---------- 9.8.5 ----------
# kindle.conf in the list gist (written by the cloud brain): where the bundle / cloud gist live
save_links() {
    { tr -d '\r' < "$T/b.$$" | grep -o '\(BUNDLE_URL\|CLOUD_GIST\|ICS_URL\|ICS2_URL\|TV_REF\|EXTRA_URL\|BOOKS_URL\)=[^\\" ]*'
      tr -d '\r' < "$T/b.$$" | grep -o 'lastRun\\*"*: *[0-9]\{13\}' | head -1 | sed 's/.*\([0-9]\{10\}\)[0-9]\{3\}$/BRAIN_AT=\1/'; } | sort -u > "$T/links.$$"
    if [ -s "$T/links.$$" ]; then cmp -s "$T/links.$$" "$DIR/.cloud_links" || { mv "$T/links.$$" "$DIR/.cloud_links"; say "cloud brain links saved"; }
    else rm -f "$T/links.$$"; fi
}
# inbox-*.txt (Siri Shortcuts, the PC script): plain lines. The fridge takes files that only hold list items,
# fridge notes and timers; anything else (events, chores, recipe links) is left for the cloud brain.
# Ids come from the file name + position, so the brain and the fridge make the SAME item if both read it.
take_inbox() {
    : > "$T/inbox_new.$$"
    for U in $(tr -d '\r' < "$T/b.$$" | grep -o '"raw_url" *: *"[^"]*/inbox[-_][A-Za-z0-9._-]*\.txt"' | sed 's/.*"\(http[^"]*\)"$/\1/'); do
        NAME=${U##*/}
        # 10.5: a file taken before (its deletion from the gist didn't happen yet) is only deleted again. Merging
        # it a second time stamped its lines with a newer time, which re-opened items you had already ticked off.
        if grep -qxF "$NAME" "$DIR/.inbox_seen" 2>/dev/null; then echo "$NAME" >> "$T/inbox_done"; continue; fi
        C=$(kcurl -s --connect-timeout 8 --max-time 20 -H "User-Agent: KitchenHub" -o "$T/in.$$" -w '%{http_code}' "$U" 2>/dev/null)
        [ "$C" = "200" ] || continue
        TSMS="$(date +%s)000"
        awk -v name="$NAME" -v ts="$TSMS" '
            BEGIN { b = name; gsub(/[^A-Za-z0-9]/, "", b); if (length(b) > 20) b = substr(b, length(b) - 19); n = 0; bad = 0; out = "" }
            function esc(x) { gsub(/\\/, "/", x); gsub(/\t/, " ", x); return x }
            function add(kind, text) { out = out ts "\ti" b "x" n "\t" kind "\topen\t" esc(text) "\n"; n++ }
            { sub(/\r$/, ""); sub(/^[ \t]+/, ""); sub(/[ \t]+$/, "") }
            $0 == "" || /^#/ { next }
            tolower($0) ~ /^(event|chore|recipe) *:/ { bad = 1; next }
            tolower($0) ~ /^note *: *[^ ]/ { t = $0; sub(/^[^:]*: */, "", t); gsub(/\|/, "/", t); add("msg", substr(t, 1, 280)); next }
            tolower($0) ~ /^timer *: *[0-9]+/ { t = $0; sub(/^[^:]*: */, "", t); sub(/[^0-9].*$/, "", t); add("cmd", "timer|" t); next }
            tolower($0) ~ /^(timer|note) *:/ { next }
            { t = $0; if (tolower(t) ~ /^(shop|buy|list) *:/) sub(/^[^:]*: */, "", t)
              k = split(t, parts, / *, */); for (i = 1; i <= k; i++) if (parts[i] != "") { p = parts[i]; gsub(/\|/, "/", p); add("shop", substr(p, 1, 80)) } }
            END { if (!bad) printf "%s", out; else exit 3 }' "$T/in.$$" >> "$T/inbox_new.$$" && { echo "$NAME" >> "$T/inbox_done"; echo "$NAME" >> "$DIR/.inbox_seen"; }
    done
    [ -f "$DIR/.inbox_seen" ] && [ "$(grep -c . "$DIR/.inbox_seen")" -gt 300 ] && { tail -n 200 "$DIR/.inbox_seen" > "$DIR/.inbox_seen.tmp" && mv "$DIR/.inbox_seen.tmp" "$DIR/.inbox_seen"; }
    if [ -s "$T/inbox_new.$$" ]; then merge_local "$T/inbox_new.$$"; say "inbox: $(grep -c . "$T/inbox_new.$$") items from Siri/PC"; fi
    rm -f "$T/inbox_new.$$" "$T/in.$$"
}

# ---------- v11: the hub on the PC ----------
# cloud.conf with PC_URL=http://<pc address>:8770  PC_ID=d...  PC_KEY=<64 hex>  (desktop mode > Devices > Pair the
# fridge) = the list, check-in, logs and the package come from the PC over home Wi-Fi instead of GitHub.
# Every request is signed (HMAC-SHA256 with this fridge's own key, a timestamp and a random part, so it can't be
# replayed or forged on the home network). Removing the PC_ lines goes straight back to the GitHub cloud.
pc_mode() { [ -n "$PC_URL" ] && [ -n "$PC_ID" ] && [ -n "$PC_KEY" ]; }
OSSL=$(command -v openssl 2>/dev/null)
pc_sig() {      # $1 method $2 path $3 body file (may be empty) -> sets PC_TS PC_SIG
    PC_TS="$(date +%s)000.$(head -c 6 /dev/urandom | od -An -tx1 | tr -cd '0-9a-f' | cut -c1-10)"
    if [ -n "$3" ] && [ -s "$3" ]; then BH=$("$OSSL" dgst -sha256 < "$3" | awk '{ print $NF }')
    else BH=$(printf '' | "$OSSL" dgst -sha256 | awk '{ print $NF }'); fi
    PC_SIG=$(printf '%s\n%s\n%s\n%s' "$PC_TS" "$1" "$2" "$BH" | "$OSSL" dgst -sha256 -mac HMAC -macopt "hexkey:$PC_KEY" | awk '{ print $NF }')
}
# pc_api METHOD PATH [body file] [extra curl args] -> http code; body in $T/b.$$, headers in $T/h.$$
pc_api() {
    M=$1; P=$2; F=$3; shift 3 2>/dev/null || shift $#
    pc_sig "$M" "$P" "$F"
    if [ -n "$F" ]; then
        "$CURL" -s --connect-timeout 6 --max-time 30 -X "$M" -H "X-KH-Dev: $PC_ID" -H "X-KH-Ts: $PC_TS" -H "X-KH-Sig: $PC_SIG" \
            -H "Content-Type: text/plain" --data-binary "@$F" -D "$T/h.$$" -o "$T/b.$$" -w '%{http_code}' "$@" "$PC_URL$P" 2>/dev/null
    else
        "$CURL" -s --connect-timeout 6 --max-time 30 -X "$M" -H "X-KH-Dev: $PC_ID" -H "X-KH-Ts: $PC_TS" -H "X-KH-Sig: $PC_SIG" \
            -D "$T/h.$$" -o "$T/b.$$" -w '%{http_code}' "$@" "$PC_URL$P" 2>/dev/null
    fi
}
pc_fail() {
    case "$1" in
        000) fail "the PC didn't answer (is it on? same Wi-Fi?)" ;;
        401) fail "the PC refused this fridge - pair it again (desktop mode > Devices)" ;;
        429) fail "the PC is refusing for a while (too many bad requests)" ;;
        *) fail "the PC answered $1" ;;
    esac
}
pc_sync() {
    [ -n "$OSSL" ] || fail "the PC needs openssl on the Kindle (not found)"
    llock; cp "$LOCAL" "$T/up.$$"; lunlock
    CODE=$(pc_api POST /api/store "$T/up.$$")          # the PC merges and answers with the whole merged list
    [ "$CODE" = "200" ] || pc_fail "$CODE"
    merge "$T/r.$$" "$T/b.$$" && mv "$T/r.$$" "$REMOTE"
    merge_local "$REMOTE"
    CODE=$(pc_api GET /api/kindle/links "")
    if [ "$CODE" = "200" ] && grep -q '^BUNDLE_URL=http' "$T/b.$$"; then
        tr -d '\r' < "$T/b.$$" | grep '^[A-Z0-9_]*=[^ ]*$' | sort -u > "$T/links.$$"
        cmp -s "$T/links.$$" "$DIR/.cloud_links" || { mv "$T/links.$$" "$DIR/.cloud_links"; say "PC links saved"; }
        rm -f "$T/links.$$"
    fi
    N=$(grep -c -v '^#' "$LOCAL")
    echo "ok $(date +%s)" > "$STF"
    NOWS=$(date +%s)
    [ $((NOWS - $(num0 "$DIR/.status_at"))) -ge 1200 ] && do_status
    # (no log here: the loop sends the log after every full sync and the daily session - sending it here too made two)
    cmp -s "$LOCAL" "$T/up.$$" || say "lists synced with the PC, $N items"
    write_js
}
# $1 = where to save the update list, $2 = where to save the files' address. The PC signs the list's body
# (X-KH-Body: HMAC of the body with this fridge's key); a list without the right signature is refused.
pc_manifest() {
    [ -n "$OSSL" ] || { say "updates from the PC need openssl"; return 1; }
    CODE=$(pc_api GET /api/kindle/update "")
    [ "$CODE" = "200" ] || { say "update list from the PC: $CODE"; return 1; }
    WANT=$(tr -d '\r' < "$T/h.$$" | sed -n 's/^[Xx]-[Kk][Hh]-[Bb]ody: *\([0-9a-f]\{64\}\).*/\1/p' | head -1)
    GOT=$("$OSSL" dgst -sha256 -mac HMAC -macopt "hexkey:$PC_KEY" < "$T/b.$$" | awk '{ print $NF }')
    [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { say "update list from the PC: signature wrong - refused"; return 1; }
    U=$(tr -d '\r' < "$T/h.$$" | sed -n 's/^[Xx]-[Kk][Hh]-[Ff]iles: *\(http[^ ]*\).*/\1/p' | head -1)
    case "$U" in "$PC_URL"/upd/*) ;; *) say "update list from the PC: odd files address - refused"; return 1 ;; esac
    head -1 "$T/b.$$" | grep -q '^version ' || return 1
    mv "$T/b.$$" "$1"; printf '%s\n' "$U" > "$2"; rm -f "$T/h.$$"
}
# v11: pair with the PC: $1 = http://address:port, $2 = the pairing code shown in the PC's control panel.
# Writes PC_URL / PC_ID / PC_KEY to cloud.conf; the answer for the page goes in mesquite/pcpair.js.
pc_pair() {
    PJ="$DIR/mesquite/pcpair.js"
    printf '{"code":"%s","name":"Fridge","kind":"kindle"}' "$2" > "$T/pp.$$"
    CODE=$("$CURL" -s --connect-timeout 6 --max-time 20 -X POST -H "Content-Type: application/json" --data-binary "@$T/pp.$$" -o "$T/b.$$" -w '%{http_code}' "$1/api/pair" 2>/dev/null)
    rm -f "$T/pp.$$"
    ID=$(sed -n 's/.*"id" *: *"\(d[0-9a-f]\{12\}\)".*/\1/p' "$T/b.$$" 2>/dev/null); KEY=$(sed -n 's/.*"secret" *: *"\([0-9a-f]\{64\}\)".*/\1/p' "$T/b.$$" 2>/dev/null)
    if [ "$CODE" = "200" ] && [ -n "$ID" ] && [ -n "$KEY" ]; then
        [ -f "$CONF" ] || ( umask 077; echo "# Kitchen Hub" > "$CONF" )
        HC_DIR=$DIR; . "$DIR/hub_common.sh" 2>/dev/null
        if hub_conf_set PC_URL "$1" && hub_conf_set PC_ID "$ID" && hub_conf_set PC_KEY "$KEY"; then
            echo "window.HUB_PCPAIR={ok:1,msg:\"Paired\",ts:$(date +%s)};" > "$PJ"; say "paired with the PC at $1"; rm -f "$T/b.$$"; return 0
        fi
        M="could not write cloud.conf"
    else
        case "$CODE" in 000) M="no answer from $1 - check the address and that the PC is on" ;; 403) M="the PC refused the code - make a new one and type it again" ;; 429) M="too many tries - wait 15 minutes" ;; *) M="the PC answered $CODE" ;; esac
    fi
    echo "window.HUB_PCPAIR={ok:0,msg:\"$M\",ts:$(date +%s)};" > "$PJ"; say "pairing: $M"; rm -f "$T/b.$$"; return 1
}
pc_alert() {      # $1 = text: the PC sends it to your phone (instead of ntfy)
    printf '%s' "$1" | tr -d '\r\n' | cut -c1-200 > "$T/al.$$"
    CODE=$(pc_api POST /api/kindle/alert "$T/al.$$"); rm -f "$T/al.$$" "$T/h.$$" "$T/b.$$"
    [ "$CODE" = "200" ]
}
pc_rsearch() {     # $1 = what to search -> mesquite/rsearch.js (the PC does the search)
    Q=$(printf '%s' "$1" | tr -cd 'A-Za-z0-9 -' | cut -c1-40 | sed 's/ /+/g')
    CODE=$(pc_api GET "/api/kindle/rsearch?q=$Q" "")
    if [ "$CODE" = "200" ] && head -c 20 "$T/b.$$" | grep -q '^window.HUB_RSEARCH'; then
        mv "$T/b.$$" "$DIR/mesquite/rsearch.js"; say "recipe search on the PC: done"
    else say "recipe search: the PC couldn't do it ($CODE) - kept the last results"; fi
    rm -f "$T/h.$$" "$T/b.$$"
}
# JSON string from a file (stdin): backslash, quote, tab, CR, other control chars; newline -> \n
jstr() { tr -d '\000-\010\013\014\016-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$TAB/\\\\t/g" | awk '{ printf "%s\\n", $0 }'; }
do_status() {
    pc_mode || { [ -n "$GIST_ID" ] && [ -n "$GH_TOKEN" ]; } || return 0
    B="$DIR/mesquite/battery.js"; S="$DIR/mesquite/state.js"
    num() { sed -n "s/.*[ {,]$1: *\(-*[0-9.][0-9.]*\).*/\1/p" "$2" 2>/dev/null | head -1; }
    PCT=$(num pct "$B"); CH=$(num charging "$B"); R7=$(num rate7 "$B"); L7=$(num left7 "$B"); INT=$(num interval "$B")
    V=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$DIR/power_loop.sh" | head -1)
    LS=$(cat "$DIR/.last_sync" 2>/dev/null | head -1 | tr -cd '0-9')
    CD=$(cat "$DIR/.cloud_data_at" 2>/dev/null | tr -cd '0-9')
    REM=0; [ -f "$DIR/.charge_reminded" ] && REM=1
    WR=$(sed -n 's/.*wakeReason: *"\([a-z]*\)".*/\1/p' "$S" 2>/dev/null | head -1)
    # the cloud brain fetches the news and markets for the fridge: it needs your choices from Settings
    NEWS=$(grep '^http' "$DIR/news.conf" 2>/dev/null | tr -d '"\\\r' | tr '\n' ';')
    STK=$(grep -v '^[[:space:]]*#' "$DIR/stocks.conf" 2>/dev/null | tr -d '"\\\r' | tr '\n' ' ')
    # 10.2: what the updater did last (installed / healthy / rolledback), the auto-update setting, a waiting version
    UEV=$(cat "$DIR/.update/event" 2>/dev/null | head -1 | tr -cd 'A-Za-z0-9 .-' | cut -c1-80)
    AUP=$(sed -n 's/^AUTO_UPDATE=\([0-2]\)$/\1/p' "$DIR/eco.conf" 2>/dev/null | head -1)
    BKS=$(cut -f1 "$DIR/.books_have" 2>/dev/null | tr -cd 'A-Za-z0-9\n' | awk 'NF { printf "%s\"%s\"", (n++ ? "," : ""), $0 }')      # 10.3: books on this Kindle
    UAV=$(grep -o 'state:"available",cur:"[^"]*",nv:"[^"]*"' "$DIR/mesquite/update.js" 2>/dev/null | sed 's/.*nv:"\([^"]*\)"/\1/' | tr -cd 'A-Za-z0-9.-')
    # 10.10: yesterday's energy report, and when the fridge reports in by itself (the daily session hour, -1 = off)
    EN=$(head -1 "$DIR/.energy_last" 2>/dev/null | tr -cd 'A-Za-z0-9 .,:;%()/|~>-' | cut -c1-300)
    DS=$(sed -n 's/^DAILY_SESSION=\([01]\)$/\1/p' "$DIR/eco.conf" 2>/dev/null | head -1)
    DH=$(sed -n 's/^DAILY_HOUR=\([0-9][0-9]*\)$/\1/p' "$DIR/eco.conf" 2>/dev/null | head -1)
    [ "${DS:-1}" = "1" ] && DH=${DH:-3} || DH=-1
    printf '{"ts":%s,"v":"%s","pct":%s,"charging":%s,"rate7":%s,"left7":%s,"interval":%s,"lastSync":%s,"cloudData":%s,"reminded":%s,"wake":"%s","items":%s,"news":"%s","stocks":"%s","upd":"%s","auto":%s,"avail":"%s","books":[%s],"energy":"%s","daily":%s}' \
        "$(date +%s)" "$V" "${PCT:-0}" "${CH:-0}" "${R7:-0}" "${L7:-0}" "${INT:-60}" "${LS:-0}" "${CD:-0}" "$REM" "$WR" "$(grep -c -v '^#' "$LOCAL")" "$NEWS" "$STK" "$UEV" "${AUP:-2}" "$UAV" "$BKS" "$EN" "$DH" > "$T/st.$$"
    if pc_mode; then CODE=$(pc_api POST /api/kindle/status "$T/st.$$")
    else
        { printf '{"files":{"kindle.json":{"content":"'; jstr < "$T/st.$$" | sed 's/\\n$//'; printf '"}}}'; } > "$T/p.$$"
        CODE=$(api PATCH "$API/gists/$GIST_ID" -H "Content-Type: application/json" --data-binary "@$T/p.$$")
    fi
    [ "$CODE" = "200" ] && { date +%s > "$DIR/.status_at"; rm -f "$ETAGF"; } || say "status upload refused ($CODE)"
    rm -f "$T/st.$$" "$T/p.$$" "$T/h.$$" "$T/b.$$"
}
do_log() {
    pc_mode || [ -n "$GH_TOKEN" ] || return 0
    CG=$(sed -n 's/^CLOUD_GIST=\([A-Za-z0-9]*\)$/\1/p' "$DIR/.cloud_links" 2>/dev/null | head -1)
    pc_mode || [ -n "$CG" ] || { say "log upload: no cloud gist yet (the GitHub Action makes it)"; return 0; }
    {
        echo "Kitchen Hub log - $(date)"
        [ -s "$DIR/.log_want" ] && { echo "== why this was sent (10.7)"; tail -n 10 "$DIR/.log_want"; }
        [ -s "$DIR/.boot_fail" ] && { echo "== last failed start"; cat "$DIR/.boot_fail"; }
        echo "== power.log"; tail -n 220 "$DIR/power.log" 2>/dev/null
        echo "== sync.log"; tail -n 120 "$LOG" 2>/dev/null; echo "== hub.log"; tail -n 40 "$DIR/hub.log" 2>/dev/null
        [ -s "$DIR/.sysprobe.txt" ] && { echo "== system (10.9 task manager / hub mode probe)"; cat "$DIR/.sysprobe.txt"; }
    } | sed 's/github_pat_[A-Za-z0-9_]*/<token>/g; s/ghp_[A-Za-z0-9]*/<token>/g' > "$T/lg.$$"
    if pc_mode; then CODE=$(pc_api POST /api/kindle/log "$T/lg.$$")
    else
        { printf '{"files":{"kindle-log.txt":{"content":"'; jstr < "$T/lg.$$"; printf '"}}}'; } > "$T/p.$$"
        CODE=$(api PATCH "$API/gists/$CG" -H "Content-Type: application/json" --data-binary "@$T/p.$$")
    fi
    [ "$CODE" = "200" ] && { date +%s > "$DIR/.log_up_at"; say "log uploaded"; } || say "log upload refused ($CODE)"
    rm -f "$T/lg.$$" "$T/p.$$" "$T/h.$$" "$T/b.$$"
}

do_sync() {
    pc_mode || { [ -n "$GIST_ID" ] && [ -n "$GH_TOKEN" ]; } || { echo "not set up" > "$STF"; write_js; exit 0; }
    if ! mkdir "$T/slock" 2>/dev/null; then          # one sync at a time
        OP=$(cat "$T/slock/pid" 2>/dev/null); [ -n "$OP" ] && kill -0 "$OP" 2>/dev/null && exit 0
        rm -rf "$T/slock"; mkdir "$T/slock" || exit 0
    fi
    echo $$ > "$T/slock/pid"
    trap 'rm -rf "$T/slock"; rm -f "$T"/*.$$ "/tmp/khh.$$"' EXIT
    if pc_mode; then pc_sync; return; fi
    ROUND=0; PUSHED=0; SAME=0
    while [ $ROUND -lt 4 ]; do
        ROUND=$((ROUND + 1))
        pull 1; merge_local "$REMOTE"
        cmp -s "$LOCAL" "$REMOTE" && { SAME=1; break; }
        pull 0; merge_local "$REMOTE"                   # fresh copy right before writing: smallest race window
        cmp -s "$LOCAL" "$REMOTE" && { SAME=1; break; }
        push; PUSHED=1
        sleep ${HUB_VERIFY_DELAY:-3}                    # a phone may have written in the same moment: look again
        pull 0; merge_local "$REMOTE"
        cmp -s "$LOCAL" "$REMOTE" && { SAME=1; break; }
    done
    N=$(grep -c -v '^#' "$LOCAL")
    echo "ok $(date +%s)" > "$STF"
    # 9.8.5: tell the phone/TV/cloud how the fridge is doing (at most every 20 min), and a daily log
    NOWS=$(date +%s)
    [ $((NOWS - $(num0 "$DIR/.status_at"))) -ge 1200 ] && do_status
    [ "${DAILY_LOG:-1}" = "1" ] && [ $((NOWS - $(num0 "$DIR/.log_up_at"))) -ge 86400 ] && [ -s "$DIR/.cloud_links" ] && do_log
    if [ $SAME = 1 ]; then [ $PUSHED = 1 ] && say "lists synced, $N items (uploaded)"; else say "lists: still changing after $ROUND rounds, will finish next time"; fi
    write_js
}

# 10.9: the first connection to the cloud needs an authenticator code on the Kindle (Settings > Security).
# Until then nothing is sent to or fetched from GitHub; lists keep working on the fridge alone.
cloud_gate() {
    HC_DIR=$DIR; HC_WHO=cloud
    . "$DIR/hub_common.sh" 2>/dev/null || return 0
    hub_cloud_allowed && return 0
    echo "waiting for the authenticator code (Settings > Security)" > "$STF"; write_js
    say "not connected yet: enter an authenticator code on the Kindle first (Settings > Security)"
    return 1
}
case "$1" in
    sync|status|log) pc_mode || { [ -n "$GIST_ID" ] && [ -n "$GH_TOKEN" ] && { cloud_gate || exit 0; }; } ;;     # v11: pairing with the PC replaces the gate
esac
case "$1" in
    sync) do_sync ;;
    add)
        urldecode "$2" | tr -d '\r' > "$T/a.$$"; echo >> "$T/a.$$"     # 9.6: one request may carry many lines
        merge_local "$T/a.$$"; rm -f "$T/a.$$"
        write_js ;;
    js) write_js ;;
    status) do_status ;;
    log) do_log ;;
    rsearch) pc_mode && pc_rsearch "$2" ;;
    pcmode) pc_mode ;;
    manifest) pc_mode && pc_manifest "$2" "$3" ;;
    alert) pc_mode && pc_alert "$2" ;;
    pair) pc_pair "$2" "$3" ;;
esac
