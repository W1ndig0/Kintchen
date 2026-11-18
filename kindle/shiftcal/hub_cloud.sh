#!/bin/sh
# Kitchen Hub cloud lists: exchanges hub.tsv with your private GitHub gist.
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
GIST_ID=""; GH_TOKEN=""; API="https://api.github.com"
[ -f "$CONF" ] && . "$CONF"
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
mkdir -p "$T" "$DIR/mesquite"
[ -f "$LOCAL" ] || echo "#hub v1" > "$LOCAL"

merge() { sh "$DIR/hub_merge.sh" "$@"; }
say() { echo "$(date '+%m-%d %H:%M:%S') [cloud] $*" >> "$LOG"; }
urldecode() { printf '%b' "$(echo "$1" | sed -e 's/+/ /g' -e 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')"; }

# hub.tsv is changed by "add" (from the page) while a sync may be running: every read-modify-write
# of it happens inside this short lock
llock() {
    N=0
    while ! mkdir "$T/llock" 2>/dev/null; do
        N=$((N + 1)); [ $N -ge 8 ] && { rm -rf "$T/llock"; N=0; }    # stale lock from a killed run
        sleep 1
    done
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
api() {
    M=$1; U=$2; shift 2
    $CURL -s -k --connect-timeout 8 --max-time 25 -X "$M" \
        -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" -H "User-Agent: KitchenHub" \
        -D "$T/h.$$" -o "$T/b.$$" -w '%{http_code}' "$@" "$U" 2>/dev/null
}
raw_url() { grep -o '"raw_url" *: *"[^"]*/hub\.tsv"' "$T/b.$$" | head -1 | sed 's/.*"\(http[^"]*\)"$/\1/'; }
fetch_raw() {   # $1 raw url -> canonical copy in $T/r.$$
    [ -n "$1" ] || return 1
    C=$($CURL -s -k --connect-timeout 8 --max-time 25 -H "User-Agent: KitchenHub" -o "$T/raw.$$" -w '%{http_code}' "$1" 2>/dev/null)
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
    { tr -d '\r' < "$T/b.$$" | grep -o '\(BUNDLE_URL\|CLOUD_GIST\|ICS_URL\|ICS2_URL\|TV_REF\|EXTRA_URL\)=[^\\" ]*'
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
        C=$($CURL -s -k --connect-timeout 8 --max-time 20 -H "User-Agent: KitchenHub" -o "$T/in.$$" -w '%{http_code}' "$U" 2>/dev/null)
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
            END { if (!bad) printf "%s", out; else exit 3 }' "$T/in.$$" >> "$T/inbox_new.$$" && echo "$NAME" >> "$T/inbox_done"
    done
    if [ -s "$T/inbox_new.$$" ]; then merge_local "$T/inbox_new.$$"; say "inbox: $(grep -c . "$T/inbox_new.$$") items from Siri/PC"; fi
    rm -f "$T/inbox_new.$$" "$T/in.$$"
}
# JSON string from a file (stdin): backslash, quote, tab, CR, other control chars; newline -> \n
jstr() { tr -d '\000-\010\013\014\016-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$TAB/\\\\t/g" | awk '{ printf "%s\\n", $0 }'; }
do_status() {
    [ -n "$GIST_ID" ] && [ -n "$GH_TOKEN" ] || return 0
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
    printf '{"ts":%s,"v":"%s","pct":%s,"charging":%s,"rate7":%s,"left7":%s,"interval":%s,"lastSync":%s,"cloudData":%s,"reminded":%s,"wake":"%s","items":%s,"news":"%s","stocks":"%s"}' \
        "$(date +%s)" "$V" "${PCT:-0}" "${CH:-0}" "${R7:-0}" "${L7:-0}" "${INT:-60}" "${LS:-0}" "${CD:-0}" "$REM" "$WR" "$(grep -c -v '^#' "$LOCAL")" "$NEWS" "$STK" > "$T/st.$$"
    { printf '{"files":{"kindle.json":{"content":"'; jstr < "$T/st.$$" | sed 's/\\n$//'; printf '"}}}'; } > "$T/p.$$"
    CODE=$(api PATCH "$API/gists/$GIST_ID" -H "Content-Type: application/json" --data-binary "@$T/p.$$")
    [ "$CODE" = "200" ] && { date +%s > "$DIR/.status_at"; rm -f "$ETAGF"; } || say "status upload refused ($CODE)"
    rm -f "$T/st.$$" "$T/p.$$" "$T/h.$$" "$T/b.$$"
}
do_log() {
    [ -n "$GH_TOKEN" ] || return 0
    CG=$(sed -n 's/^CLOUD_GIST=\([A-Za-z0-9]*\)$/\1/p' "$DIR/.cloud_links" 2>/dev/null | head -1)
    [ -n "$CG" ] || { say "log upload: no cloud gist yet (the GitHub Action makes it)"; return 0; }
    {
        echo "Kitchen Hub log - $(date)"; echo "== power.log"; tail -n 220 "$DIR/power.log" 2>/dev/null
        echo "== sync.log"; tail -n 120 "$LOG" 2>/dev/null; echo "== hub.log"; tail -n 40 "$DIR/hub.log" 2>/dev/null
    } | sed 's/github_pat_[A-Za-z0-9_]*/<token>/g; s/ghp_[A-Za-z0-9]*/<token>/g' > "$T/lg.$$"
    { printf '{"files":{"kindle-log.txt":{"content":"'; jstr < "$T/lg.$$"; printf '"}}}'; } > "$T/p.$$"
    CODE=$(api PATCH "$API/gists/$CG" -H "Content-Type: application/json" --data-binary "@$T/p.$$")
    [ "$CODE" = "200" ] && { date +%s > "$DIR/.log_up_at"; say "log uploaded to the cloud gist"; } || say "log upload refused ($CODE)"
    rm -f "$T/lg.$$" "$T/p.$$" "$T/h.$$" "$T/b.$$"
}

do_sync() {
    [ -n "$GIST_ID" ] && [ -n "$GH_TOKEN" ] || { echo "not set up" > "$STF"; write_js; exit 0; }
    if ! mkdir "$T/slock" 2>/dev/null; then          # one sync at a time
        OP=$(cat "$T/slock/pid" 2>/dev/null); [ -n "$OP" ] && kill -0 "$OP" 2>/dev/null && exit 0
        rm -rf "$T/slock"; mkdir "$T/slock" || exit 0
    fi
    echo $$ > "$T/slock/pid"
    trap 'rm -rf "$T/slock"; rm -f "$T"/*.$$' EXIT
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
    [ $((NOWS - $(cat "$DIR/.status_at" 2>/dev/null || echo 0))) -ge 1200 ] && do_status
    [ "${DAILY_LOG:-1}" = "1" ] && [ $((NOWS - $(cat "$DIR/.log_up_at" 2>/dev/null || echo 0))) -ge 86400 ] && [ -s "$DIR/.cloud_links" ] && do_log
    if [ $SAME = 1 ]; then [ $PUSHED = 1 ] && say "lists synced, $N items (uploaded)"; else say "lists: still changing after $ROUND rounds, will finish next time"; fi
    write_js
}

case "$1" in
    sync) do_sync ;;
    add)
        urldecode "$2" | tr -d '\r' > "$T/a.$$"; echo >> "$T/a.$$"     # 9.6: one request may carry many lines
        merge_local "$T/a.$$"; rm -f "$T/a.$$"
        write_js ;;
    js) write_js ;;
    status) do_status ;;
    log) do_log ;;
esac
