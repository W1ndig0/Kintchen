# Kitchen Hub 10.4: kcurl - curl that checks the server's certificate whenever this Kindle can.
# Sourced by the hub's shell scripts. Use it like curl, without -k.
#
# Older Kindle firmware ships an old list of trusted certificate authorities, so before 10.4 every
# download used -k (no certificate check). That works, but it means anyone on your Wi-Fi path could
# pretend to be GitHub and read your token or push a fake update. Now:
#   1. Every request first tries a normal, checked connection.
#   2. If that works once, the Kindle is marked "ok" in .tls and NEVER falls back to -k after that,
#      so a fake certificate later is refused instead of silently accepted.
#   3. Only if the checked connection fails because of the certificate AND it has never worked here
#      (an old CA list) is the request repeated with -k. It retries the checked way once a day.
#   4. Safety valve: if checked connections were fine but then fail for 3 days in a row (e.g. a site
#      moved to a new certificate authority your firmware doesn't know), it falls back so the hub
#      keeps working and can still update, and says so loudly in the log. Delete .tls to start over.
KC_DIR="${DIR:-${HUB_DIR:-/mnt/us/extensions/shiftcal}}"
KC_F="$KC_DIR/.tls"
KC_BIN="${CURL:-${CURL_BIN:-/usr/bin/curl}}"; [ -x "$KC_BIN" ] || KC_BIN=curl
kc_log() { echo "$(date '+%m-%d %H:%M:%S') [tls] $*" >> "$KC_DIR/power.log" 2>/dev/null; }
kcurl() {
    KC_M=""; KC_A=0
    [ -f "$KC_F" ] && read -r KC_M KC_A < "$KC_F" 2>/dev/null
    case "$KC_A" in ''|*[!0-9]*) KC_A=0 ;; esac
    KC_NOW=$(date +%s)
    # known old CA list, checked again less than a day ago: straight to -k
    if [ "$KC_M" = "old" ] && [ $((KC_NOW - KC_A)) -lt 86400 ]; then "$KC_BIN" -k "$@"; return $?; fi
    KC_T=$(mktemp 2>/dev/null) || KC_T="/tmp/kc.$$.$KC_NOW"
    "$KC_BIN" "$@" > "$KC_T"; KC_RC=$?
    case "$KC_RC" in
        60|77|83|51)                                    # certificate problem
            rm -f "$KC_T"
            if [ "$KC_M" = "ok" ] || [ "$KC_M" = "okfail" ]; then
                if [ "$KC_M" = "ok" ]; then echo "okfail $KC_NOW" > "$KC_F"; KC_A=$KC_NOW
                    kc_log "certificate check FAILED (curl $KC_RC) on a Kindle where it used to work - request refused. If this keeps happening, someone may be intercepting your Wi-Fi."
                fi
                if [ $((KC_NOW - KC_A)) -lt 259200 ]; then return "$KC_RC"; fi
                kc_log "certificate check failing for 3 days - falling back to unchecked connections (delete .tls to start over)"
            else
                [ "$KC_M" = "old" ] || kc_log "this Kindle's certificate list is too old for a checked connection - using unchecked ones, retrying daily"
            fi
            echo "old $KC_NOW" > "$KC_F"
            "$KC_BIN" -k "$@"; return $? ;;
        0)
            [ "$KC_M" = "ok" ] || { echo "ok $KC_NOW" > "$KC_F"; [ -n "$KC_M" ] && kc_log "checked connections work again"; }
            cat "$KC_T"; rm -f "$KC_T"; return 0 ;;
        *)                                              # no Wi-Fi, timeout, HTTP error with -f ...: not a certificate question
            cat "$KC_T"; rm -f "$KC_T"; return "$KC_RC" ;;
    esac
}
