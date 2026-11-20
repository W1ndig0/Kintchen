#!/bin/sh
# Kitchen Hub book cloud, Kindle side (run after a sync while Wi-Fi is on).
#   .books_want  "id<TAB>file name" for every book you marked "on the Kindle" (the hub page writes it)
#   .books_have  what this Kindle already downloaded
# Downloads missing books from your books gist into documents/Kitchen Hub (they appear in the Kindle's
# library), removes books you moved back to the cloud, and writes mesquite/books.js for the hub page.
# 10.4: books locked with your passphrase (meta "... a1 <iv>") are unlocked here with openssl (AES-256-CTR);
#       the key is made once from cloud.conf's PASSPHRASE and kept in .books/key.
DIR=${HUB_DIR:-/mnt/us/extensions/shiftcal}
LIB=${HUB_LIB:-/mnt/us/documents/Kitchen Hub}
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
KC_STRICT=1      # 10.5: your token and your books never go over an unchecked connection
[ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"; command -v kcurl >/dev/null 2>&1 || kcurl() { "$CURL" "$@"; }     # 10.5: never unchecked when kcurl.sh is missing
LOG="$DIR/sync.log"; T="$DIR/.books"; WANT="$DIR/.books_want"; HAVE="$DIR/.books_have"; OUT="$DIR/mesquite/books.js"
say() { echo "$(date '+%m-%d %H:%M:%S') [books] $*" >> "$LOG"; }
mkdir -p "$T"; touch "$WANT" "$HAVE"
BASEU=$(sed -n 's/^BOOKS_URL=\(https*:[^ ]*\)$/\1/p' "$DIR/.cloud_links" 2>/dev/null | head -1)
[ -n "${BOOKS_URL_TEST:-}" ] && BASEU=$BOOKS_URL_TEST
FAILS=""
OSSL=$(command -v openssl 2>/dev/null)
b64d() {    # base64 file -> binary file: busybox, then openssl, then plain awk (slow but always there)
    if base64 -d "$1" > "$2" 2>/dev/null && [ -s "$2" ]; then return 0; fi
    if [ -n "$OSSL" ] && "$OSSL" base64 -d -in "$1" -out "$2" 2>/dev/null && [ -s "$2" ]; then return 0; fi
    if command -v uudecode >/dev/null 2>&1; then
        { echo "begin-base64 644 -"; cat "$1"; echo "===="; } > "$1.uu"
        if uudecode -o "$2" "$1.uu" 2>/dev/null && [ -s "$2" ]; then rm -f "$1.uu"; return 0; fi
        rm -f "$1.uu"
    fi
    awk 'BEGIN { s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; for (i = 0; i < 64; i++) v[substr(s, i + 1, 1)] = i
                 p[0] = 1; for (i = 1; i <= 16; i++) p[i] = p[i - 1] * 2; b = 0; n = 0 }
         { for (i = 1; i <= length($0); i++) { c = substr($0, i, 1); if (!(c in v)) continue; b = b * 64 + v[c]; n += 6
             if (n >= 8) { n -= 8; x = int(b / p[n]); b -= x * p[n]; printf "%c", x } } }' "$1" > "$2"
    [ -s "$2" ]
}
hashof() { sha256sum "$1" 2>/dev/null | cut -c1-64; }
# 10.4: the book key (same as the phone and the cloud): SHA-256(K | "books"), K = SHA-256 x1000 of "kitchenhub|PASSPHRASE"
# 10.9: made for one passphrase at a time (bookkey PASS -> KEY), cached per passphrase in $T/keys, so after a
# key change books locked with the old passphrase (PASSPHRASE_OLD) still open.
bookpasses() {      # the passphrases to try, newest first (the old built-in one only when cloud.conf has none)
    ( PASSPHRASE="@unset@"; PASSPHRASE_OLD=""; [ -f "$DIR/cloud.conf" ] && . "$DIR/cloud.conf" >/dev/null 2>&1
      [ "$PASSPHRASE" = "@unset@" ] && { HC_DIR=$DIR; . "$DIR/hub_common.sh" 2>/dev/null; PASSPHRASE=$(hc_legacy_pass); }      # no PASSPHRASE line (as before 10.9)
      [ -z "$PASSPHRASE_OLD" ] && [ -s "$DIR/.pass_old" ] && PASSPHRASE_OLD=$(cat "$DIR/.pass_old")
      printf '%s\n' "$PASSPHRASE" | tr -d '\r'; [ -n "$PASSPHRASE_OLD" ] && printf '%s\n' "$PASSPHRASE_OLD" | tr -d '\r' )
}
bookkey() {
    KEY=""; BK_PASS="$1"
    [ -n "$BK_PASS" ] && [ -n "$OSSL" ] || return 1
    PH=$(printf '%s' "$BK_PASS" | sha256sum | cut -c1-64)
    KEY=$(grep "^$PH " "$T/keys" 2>/dev/null | head -1 | cut -d' ' -f2)
    [ ${#KEY} = 64 ] && return 0
    printf 'kitchenhub|%s' "$BK_PASS" > "$T/k"; I=0
    while [ "$I" -lt 1000 ]; do "$OSSL" dgst -sha256 -binary "$T/k" > "$T/k2" && mv "$T/k2" "$T/k" || return 1; I=$((I + 1)); done
    printf 'books' >> "$T/k"
    KEY=$("$OSSL" dgst -sha256 -binary "$T/k" | od -An -v -tx1 | tr -d ' \n'); rm -f "$T/k"
    [ "${#KEY}" = 64 ] || return 1
    ( umask 077; echo "$PH $KEY" >> "$T/keys" ); rm -f "$T/key"; say "made the book key"
}
KEY=""
# 1. books moved back to the cloud (or deleted): take them off the Kindle
: > "$HAVE.tmp"
while IFS="	" read -r ID FN; do
    [ -n "$ID" ] || continue
    if grep -qxF "$ID	$FN" "$WANT"; then echo "$ID	$FN" >> "$HAVE.tmp"      # same book, same name (an EPUB converted to AZW3 gets a new name)
    else rm -f "$LIB/$FN"; say "removed $FN from the Kindle (kept in your book cloud)"; fi
done < "$HAVE"
mv "$HAVE.tmp" "$HAVE"
# 2. books you want on the Kindle that aren't here yet (two per sync, so a wake never runs long)
N=0
if [ -n "$BASEU" ]; then
    while IFS="	" read -r ID FN; do
        [ -n "$ID" ] && [ -n "$FN" ] || continue
        grep -qxF "$ID	$FN" "$HAVE" && [ -f "$LIB/$FN" ] && continue
        [ "$N" -ge 2 ] && break
        FREE=$(df -k "$(dirname "$LIB")" 2>/dev/null | awk 'NR == 2 { print $4 }')
        M=$(kcurl -sf --connect-timeout 8 --max-time 20 "${BASEU}bk_$ID.meta" 2>/dev/null | head -1)
        set -- $M
        SIZE=$2; SHA=$3; NP=$4; ENC=$5; IV=$6      # $1 = the format (the file name already ends in it)
        case "$NP" in ''|*[!0-9]*) FAILS="$FAILS$ID:not in the cloud yet,"; continue ;; esac
        [ -n "$FREE" ] && [ "$FREE" -lt $((SIZE / 1024 + 51200)) ] && { FAILS="$FAILS$ID:Kindle storage is full,"; say "no room for $FN"; continue; }
        if [ "$ENC" = "a1" ] && [ -z "$OSSL" ]; then FAILS="$FAILS$ID:this Kindle has no openssl to unlock books,"; say "can't unlock $FN"; continue; fi
        : > "$T/b64"; OK=1; I=0; UNL=""
        while [ "$I" -lt "$NP" ]; do
            kcurl -sf --connect-timeout 8 --max-time 120 "${BASEU}bk_$ID.p$I" >> "$T/b64" 2>/dev/null || { OK=0; break; }
            echo >> "$T/b64"; I=$((I + 1))
        done
        if [ "$OK" = "1" ] && b64d "$T/b64" "$T/book" && [ "$(wc -c < "$T/book" | tr -d ' ')" = "$SIZE" ]; then
            if [ "$ENC" = "a1" ]; then      # 10.9: the newest passphrase first, then the one before the last key change
                UNL=0
                bookpasses > "$T/passes"
                while IFS= read -r BP; do
                    bookkey "$BP" || continue
                    "$OSSL" enc -d -aes-256-ctr -K "$KEY" -iv "$IV" -in "$T/book" -out "$T/plain" 2>/dev/null || continue
                    [ "$(hashof "$T/plain")" = "$SHA" ] && { mv "$T/plain" "$T/book"; UNL=1; break; }
                done < "$T/passes"
                rm -f "$T/passes" "$T/plain"
                [ "$UNL" = "1" ] || { OK=0; FAILS="$FAILS$ID:locked with a passphrase this Kindle doesn't have,"; }
            fi
        else OK=0; fi
        if [ "$OK" = "1" ] && [ "$(hashof "$T/book")" = "$SHA" ]; then
            mkdir -p "$LIB"; mv "$T/book" "$LIB/$FN" && echo "$ID	$FN" >> "$HAVE"; say "downloaded $FN ($SIZE bytes)"; N=$((N + 1))
        else
            [ "$UNL" = "0" ] || FAILS="$FAILS$ID:download didn't check out - will try again,"; say "download of $FN failed, will retry"
        fi
        rm -f "$T/b64" "$T/book" "$T/plain"
    done < "$WANT"
fi
# 3. tell the page
FREE=$(df -k "$(dirname "$LIB")" 2>/dev/null | awk 'NR == 2 { print $4 }')
{
    printf 'window.HUB_BOOKS={ts:%s,free:%s,have:[' "$(date +%s)" "${FREE:-0}"
    cut -f1 "$HAVE" | tr -cd 'A-Za-z0-9\n' | awk 'NF { printf "%s\"%s\"", (n++ ? "," : ""), $0 }'
    printf '],fail:{'
    printf '%s' "$FAILS" | tr ',' '\n' | awk -F: 'NF >= 2 { m = substr($0, length($1) + 2); gsub(/["\\]/, "", m); printf "%s\"%s\":\"%s\"", (n++ ? "," : ""), $1, m }'
    printf '}};\n'
} > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
