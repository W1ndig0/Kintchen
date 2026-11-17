#!/bin/sh
# Kitchen Hub cloud lists: exchanges hub.tsv with your private GitHub gist.
#   hub_cloud.sh sync          pull, merge, push if needed (needs Wi-Fi on). Prints nothing; see sync.log
#   hub_cloud.sh add LINE      store one edit made on the fridge (LINE url-encoded) and refresh the page
#   hub_cloud.sh js            rewrite mesquite/hub_items.js from hub.tsv
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
             tr -d '\r' < "$T/h.$$" | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p' | head -1 > "$ETAGF" ;;
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
        printf '{"files":{"hub.tsv":{"content":"'
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
    rm -f "$ETAGF"
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
    if [ $SAME = 1 ]; then [ $PUSHED = 1 ] && say "lists synced, $N items (uploaded)"; else say "lists: still changing after $ROUND rounds, will finish next time"; fi
    write_js
}

case "$1" in
    sync) do_sync ;;
    add)
        urldecode "$2" | tr -d '\r\n' > "$T/a.$$"; echo >> "$T/a.$$"
        merge_local "$T/a.$$"; rm -f "$T/a.$$"
        write_js ;;
    js) write_js ;;
esac
