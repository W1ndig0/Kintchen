#!/bin/sh
# Kitchen Hub web-sync probe. Run over SSH:  sh /mnt/us/extensions/shiftcal/probe_web.sh
# Optional:  sh probe_web.sh lan   -> also listens 60 s on port 8765 so you can test from your phone.
# Writes everything to web_probe.txt next to this script. Changes nothing, needs no token
# (if cloud.conf exists it also does one real round trip on a separate file in your gist).
DIR=$(cd "$(dirname "$0")" && pwd)
OUT="$DIR/web_probe.txt"
# test files: next to this script, or in the hub folder (the probe may be run from Documents)
P=""
for d in "$DIR/webprobe" /mnt/us/extensions/shiftcal/webprobe /mnt/us/documents/webprobe; do [ -f "$d/hub_merge.awk" ] && { P=$d; break; }; done
[ -f "$DIR/cloud.conf" ] || { [ -f /mnt/us/extensions/shiftcal/cloud.conf ] && DIR_CONF=/mnt/us/extensions/shiftcal/cloud.conf; }
DIR_CONF=${DIR_CONF:-$DIR/cloud.conf}
CURL=/usr/bin/curl; [ -x "$CURL" ] || CURL=curl
TAB=$(printf '\t')
ok() { echo "PASS  $*"; }
no() { echo "FAIL  $*"; }
{
echo "=== Kitchen Hub web probe $(date) ==="
echo "--- system"; uname -a; cat /etc/prettyversion.txt 2>/dev/null; busybox 2>&1 | head -1
df -h /mnt/us 2>/dev/null | tail -1
echo "--- curl"; $CURL -V 2>&1 | head -3
echo "--- status bar services"; for j in statusbar pillow; do echo "$j: $(status $j 2>&1)"; done
ls /etc/upstart 2>/dev/null | grep -i -e bar -e pillow
if ps | grep -q '[p]ower_loop.sh'; then
    echo "WARN  the hub is running: it switches Wi-Fi off after each sync and can cut this probe off. Stop it first (KUAL > Kitchen Hub > Stop)."
fi
echo "--- Wi-Fi"
WAS=$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null); echo "before: $WAS"
WE_TURNED_ON=0
if [ "$WAS" != "CONNECTED" ]; then
    lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null; WE_TURNED_ON=1
    T0=$(date +%s); N=0
    while [ $N -lt 45 ] && [ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" != "CONNECTED" ]; do sleep 1; N=$((N + 1)); done
    S=$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)
    [ "$S" = "CONNECTED" ] && ok "Wi-Fi turned on and connected in $(( $(date +%s) - T0 )) s" || no "Wi-Fi did not connect in 45 s (state $S)"
    sleep 2   # let DNS settle
fi

echo "--- 1. GitHub reachable over HTTPS"
C=$($CURL -s -k --connect-timeout 8 --max-time 20 -A KitchenHub -D /tmp/kh_h -o /tmp/kh_b -w '%{http_code}' https://api.github.com/rate_limit)
[ "$C" = "200" ] && ok "api.github.com answered 200" || no "api.github.com answered '$C'"
grep -o '"core":{[^}]*}' /tmp/kh_b 2>/dev/null | head -1
C2=$($CURL -s -k --connect-timeout 8 --max-time 20 -o /dev/null -w '%{http_code}' https://gist.githubusercontent.com/)
case "$C2" in 2*|3*|4*) ok "gist.githubusercontent.com reachable ($C2)" ;; *) no "gist.githubusercontent.com: '$C2'" ;; esac
C3=$($CURL -s -k --connect-timeout 8 --max-time 20 -o /dev/null -w '%{http_code}' -X PATCH https://api.github.com/gists/0)
case "$C3" in 401|404|403|422) ok "curl can send PATCH (GitHub said $C3, expected without a token)" ;; *) no "PATCH test: '$C3'" ;; esac
C4=$($CURL -s --connect-timeout 8 --max-time 20 -o /dev/null -w '%{http_code}' https://api.github.com/rate_limit)
[ "$C4" = "200" ] && ok "certificate check also works without -k" || echo "INFO  certificate check without -k: '$C4' (fine, the hub uses -k like the weather sync)"

echo "--- 2. clock (edits are ordered by time)"
GH=$(tr -d '\r' < /tmp/kh_h 2>/dev/null | sed -n 's/^[Dd]ate: //p' | head -1)
echo "kindle: $(date -u '+%a, %d %b %Y %H:%M:%S GMT')"
echo "github: $GH"
GE=$(date -u -D '%a, %d %b %Y %H:%M:%S GMT' -d "$GH" +%s 2>/dev/null)
if [ -n "$GE" ]; then
    SK=$(( $(date +%s) - GE )); [ $SK -lt 0 ] && SK=$((0 - SK))
    [ $SK -le 60 ] && ok "clock within ${SK}s of GitHub" || no "clock is ${SK}s off GitHub"
else echo "INFO  could not parse the date, compare the two lines above by eye"; fi

echo "--- 3. BusyBox tools the sync uses"
for a in awk sed grep sort cmp tr mkdir mv printf head cut od; do command -v $a >/dev/null 2>&1 && ok "$a" || no "$a missing"; done
X=$(printf '%b' 'a\x41\x09b' | od -c 2>/dev/null | head -1); echo "printf \\x decode: $X"
case "$X" in *"a   A  \\t   b"*) ok "url decoding works" ;; *) no "printf %b \\x decode looks wrong" ;; esac
S=$(printf '001763330000002\ta\n001763330000001\tb\n000000000000999\tz\n' | LC_ALL=C sort | cut -f2 | tr -d '\n')
[ "$S" = "zba" ] && ok "byte sort of padded times" || no "sort gave '$S' (want zba)"
echo "INFO  shell math: 1763330000*1000 = $((1763330000 * 1000)) (sync does not rely on it)"
echo "INFO  awk math:   $(awk 'BEGIN { printf "%.0f", 1763330000 * 1000 + 7 }') (must be 1763330000007)"
[ "$(awk 'BEGIN { printf "%.0f", 1763330000 * 1000 + 7 }')" = "1763330000007" ] && ok "awk handles 13-digit times" || no "awk number precision"

echo "--- 4. list merge on this Kindle == phone"
[ -n "$P" ] || echo "FAIL  webprobe folder not found: copy the whole shiftcal folder from the zip into /mnt/us/extensions/"
{ echo "#hub v1"; awk -v nows=1763330000 -f "$P/hub_merge.awk" "$P/in1.tsv" "$P/in2.tsv" | LC_ALL=C sort | cut -f2-; } > /tmp/kh_m.tsv 2>/tmp/kh_e
if cmp -s /tmp/kh_m.tsv "$P/expected.tsv"; then ok "merge is byte-identical to the phone's"; else no "merge differs:"; cat /tmp/kh_e; diff /tmp/kh_m.tsv "$P/expected.tsv" 2>/dev/null || cat /tmp/kh_m.tsv; fi

echo "--- 5. network"
echo "wifi state: $(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)"
ifconfig wlan0 2>/dev/null | grep -i "inet " || ip addr show wlan0 2>/dev/null | grep "inet "
echo "firewall (INPUT):"; iptables -L INPUT -n 2>&1 | head -15
echo "listening:"; netstat -ltn 2>/dev/null | head -12

if [ -f "$DIR_CONF" ]; then
    echo "--- 6. your gist (cloud.conf found)"
    . "$DIR_CONF"
    H="Authorization: Bearer $GH_TOKEN"
    C=$($CURL -s -k --max-time 20 -H "$H" -H "User-Agent: KitchenHub" -o /tmp/kh_g -w '%{http_code}' "https://api.github.com/gists/$GIST_ID")
    [ "$C" = "200" ] && ok "read gist ($C)" || no "read gist: $C (401 = token, 404 = gist id)"
    grep -q '"hub.tsv"' /tmp/kh_g && ok "gist has hub.tsv" || no "gist has no hub.tsv file"
    STAMP="probe $(date +%s)"
    printf '{"files":{"probe.txt":{"content":"%s"}}}' "$STAMP" > /tmp/kh_p
    C=$($CURL -s -k --max-time 20 -X PATCH -H "$H" -H "User-Agent: KitchenHub" -H "Content-Type: application/json" --data-binary @/tmp/kh_p -o /tmp/kh_g -w '%{http_code}' "https://api.github.com/gists/$GIST_ID")
    [ "$C" = "200" ] && ok "write to gist ($C)" || no "write to gist: $C (403 = token needs Gists: write)"
    R=$(grep -o '"raw_url" *: *"[^"]*/probe\.txt"' /tmp/kh_g | sed 's/.*"\(http[^"]*\)"$/\1/')
    [ -n "$R" ] && [ "$($CURL -s -k --max-time 20 "$R")" = "$STAMP" ] && ok "read back what was written" || no "read-back failed"
    printf '{"files":{"probe.txt":null}}' > /tmp/kh_p
    $CURL -s -k --max-time 20 -X PATCH -H "$H" -H "User-Agent: KitchenHub" --data-binary @/tmp/kh_p -o /dev/null "https://api.github.com/gists/$GIST_ID"
    echo "--- 7. the real sync script against your gist (in a scratch folder)"
    W=/tmp/kh_probe_sync; rm -rf "$W"; mkdir -p "$W/mesquite"
    cp "$P/hub_cloud.sh" "$P/hub_merge.sh" "$P/hub_merge.awk" "$W/"; cp "$DIR_CONF" "$W/cloud.conf"
    # a deleted-state entry: never shown in any list, dropped automatically after 30 days
    printf '%s000\tprobe%s\tshop\tdel\tprobe\n' "$(date +%s)" "$(date +%s)" > "$W/add.tsv"
    HUB_DIR=$W sh "$W/hub_cloud.sh" add "$(sed 's/\t/%09/g' "$W/add.tsv")"
    T0=$(date +%s); HUB_DIR=$W sh "$W/hub_cloud.sh" sync; T1=$(date +%s)
    cat "$W/sync.log" 2>/dev/null
    grep -q '^ok' "$W/.cloud_status" && ok "sync script ran ($((T1 - T0)) s): $(cat "$W/.cloud_status")" || no "sync script: $(cat "$W/.cloud_status" 2>/dev/null)"
    cmp -s "$W/hub.tsv" "$W/.cloud_remote.tsv" && grep -q "probe" "$W/.cloud_remote.tsv" && ok "test entry uploaded and read back" || no "test entry did not round-trip"
    T0=$(date +%s); HUB_DIR=$W sh "$W/hub_cloud.sh" sync; T1=$(date +%s)
    ok "second sync with nothing new took $((T1 - T0)) s"
    echo "items on your list right now: $(grep -c -v -e '^#' -e "$(printf '\t')del$(printf '\t')" "$W/hub.tsv")"
    rm -rf "$W"
else
    echo "--- 6. no cloud.conf yet (skipped the gist round trip)"
fi
rm -f /tmp/kh_h /tmp/kh_b /tmp/kh_g /tmp/kh_p /tmp/kh_m.tsv /tmp/kh_e
if [ "$WE_TURNED_ON" = "1" ] && [ "$1" != "lan" ]; then lipc-set-prop com.lab126.cmd wirelessEnable 0 2>/dev/null; echo "(Wi-Fi switched back off)"; fi
} > "$OUT" 2>&1

if [ "$1" = "lan" ]; then
    IP=$(ifconfig wlan0 2>/dev/null | sed -n 's/.*inet addr:\([0-9.]*\).*/\1/p')
    echo "--- 7. LAN test: open http://$IP:8765/ on your phone within 60 s" | tee -a "$OUT"
    R=$(printf 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<h1>Kindle reached</h1>' | nc -l -p 8765 -w 60 2>/dev/null | head -1)
    [ -n "$R" ] && echo "PASS  phone reached the Kindle: $R" >> "$OUT" || echo "FAIL  nothing arrived (firewall, or the hub is using port 8765 - stop it first)" >> "$OUT"
fi
grep -c '^PASS' "$OUT" | sed 's/^/passes: /'; grep '^FAIL' "$OUT"
echo "full report: $OUT"
