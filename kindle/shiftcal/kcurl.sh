# Kitchen Hub kcurl - curl that checks the server's certificate. Sourced by the hub's shell scripts.
# Use it like curl, without -k.
#
# 10.5: the kit ships its own list of trusted certificate authorities (cacert.pem, from Mozilla via
# certifi), so a checked connection works even on Kindle firmware with an old built-in list. Order:
#   1. checked against cacert.pem (when the file is there)
#   2. checked against the Kindle's own list
#   3. ONLY for plain data (weather, news, pictures) and only if neither list works: unchecked (-k),
#      logged once a day. Scripts that download code or send your GitHub token set KC_STRICT=1 first;
#      for them step 3 never happens - the request fails instead.
# Before 10.5 the unchecked fallback applied to everything, including updates and the gist token.
KC_DIR="${DIR:-${HUB_DIR:-/mnt/us/extensions/shiftcal}}"
KC_F="$KC_DIR/.tls"
KC_CA="$KC_DIR/cacert.pem"
KC_BIN="${CURL:-${CURL_BIN:-/usr/bin/curl}}"; [ -x "$KC_BIN" ] || KC_BIN=curl
kc_log() { echo "$(date '+%m-%d %H:%M:%S') [tls] $*" >> "$KC_DIR/power.log" 2>/dev/null; }
kc_cert_err() { case "$1" in 35|51|53|54|58|59|60|77|80|82|83|90|91) return 0 ;; esac; return 1; }
kcurl() {
    KC_T=$(mktemp 2>/dev/null) || KC_T="/tmp/kc.$$.$(date +%s)"
    KC_RC=60
    if [ -s "$KC_CA" ]; then
        "$KC_BIN" --cacert "$KC_CA" "$@" > "$KC_T"; KC_RC=$?
        kc_cert_err "$KC_RC" || { cat "$KC_T"; rm -f "$KC_T"; return "$KC_RC"; }
    fi
    "$KC_BIN" "$@" > "$KC_T"; KC_RC2=$?
    if ! kc_cert_err "$KC_RC2"; then
        [ -s "$KC_CA" ] && [ "$KC_RC2" = "0" ] && kc_once ca "the hub's certificate list was refused (curl $KC_RC) but the Kindle's own list works"
        cat "$KC_T"; rm -f "$KC_T"; return "$KC_RC2"
    fi
    rm -f "$KC_T"
    if [ "${KC_STRICT:-0}" = "1" ]; then
        kc_once strict "certificate check failed (curl $KC_RC2) - request refused (updates, lists and books are never fetched unchecked)"
        return "$KC_RC2"
    fi
    kc_once data "certificate check failed (curl $KC_RC2) - fetching plain data (weather, news, pictures) unchecked"
    "$KC_BIN" -k "$@"
}
kc_once() {    # $1 kind  $2 message: logged at most once a day per kind
    KC_K="$KC_F.$1"; KC_NOW=$(date +%s); KC_L=$(cat "$KC_K" 2>/dev/null | tr -cd '0-9')
    [ -n "$KC_L" ] && [ $((KC_NOW - KC_L)) -lt 86400 ] && return 0
    echo "$KC_NOW" > "$KC_K" 2>/dev/null; kc_log "$2"
}
