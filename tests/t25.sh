# 10.10.4: how long the loop is deaf after each request from the page. It can only listen for the next tap
# once it has finished with the last one, so this is what makes tapping feel slow on the Kindle. Before
# 10.10.4 the settings handler started a program for every setting name it knows on EVERY request, even a
# plain tap; now it only looks at the names the request actually carries.
# Run: KH_TESTS=$(pwd) sh t25.sh   (about 1 minute)
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
H=$HUB_DIR
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=120\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nAUTO_UPDATE=0\nDAILY_SESSION=0\nNIGHT_FROM=0\nNIGHT_TO=0\nSLEEP_CLOCK=min\n' > "$H/eco.conf"
echo "$(( $(date +%s) - 600 ))" > "$H/.last_sync"
sh "$H/run_hub.sh" eco >/dev/null 2>&1; sleep 3
ping_page "vp=1x1" >/dev/null; sleep 1
grep -q 'page is up' "$H/power.log" || { bad "the hub did not start"; exit 1; }
# A plain tap is compared with a request that opens every settings block (names present, values empty, so
# nothing is changed). Before 10.10.4 both cost the same, because the handler looked up every name it knows
# on every request. Comparing the two makes this independent of how fast the machine running the test is.
R=$(python3 - "$(cat "$H/.port_key")" <<'PY'
import socket, time, sys, statistics
key = sys.argv[1]
def one(q):
    s = socket.socket(); s.settimeout(3); s.connect(("127.0.0.1", 8765))
    s.sendall(("GET /save?%s&pk=%s HTTP/1.0\r\n\r\n" % (q, key)).encode()); s.recv(200); s.close()
    t0 = time.time()
    while time.time() - t0 < 3:                      # wait until it is listening again
        p = socket.socket(); p.settimeout(0.5)
        try:
            p.connect(("127.0.0.1", 8765)); p.close(); return (time.time() - t0) * 1000
        except Exception:
            p.close(); time.sleep(0.002)
    return 3000.0
ALL = "touch=1&stocks=&totpon=&screen=&sleepclock=&light=&interval=&orient="
a = []; b = []
for i in range(10):
    a.append(one("touch=1")); time.sleep(0.35)
    b.append(one(ALL)); time.sleep(0.35)
ma, mb = statistics.median(a), statistics.median(b)
print("%d %d %d" % (ma, mb, round(100 * ma / mb) if mb else 999))
PY
)
TAP=$(echo "$R" | cut -d' ' -f1); ALLMS=$(echo "$R" | cut -d' ' -f2); PCT=$(echo "$R" | cut -d' ' -f3)
echo "   a tap keeps the loop busy ${TAP} ms; a request touching every settings block ${ALLMS} ms (${PCT}%)"
[ "${PCT:-999}" -lt 75 ] && ok "a plain tap skips the settings it does not mention (${PCT}% of the full cost)" || bad "a plain tap costs ${PCT}% of a full settings request - the handler is looking up names the request does not carry"
# and it must still do everything it is asked
ping_page "sleepclock=hour" >/dev/null; sleep 1
grep -q '^SLEEP_CLOCK=hour' "$H/eco.conf" && ok "a setting still takes effect" || bad "sleepclock did not save: $(grep SLEEP_CLOCK "$H/eco.conf")"
ping_page "touch=1" >/dev/null; sleep 1
grep -q 'sleepClock: "hour"' "$H/mesquite/state.js" && ok "and the page is told about it" || bad "state.js: $(grep -o 'sleepClock[^,]*' "$H/mesquite/state.js")"
ping_page "interval=7&window=9" >/dev/null; sleep 1
grep -q '^INTERVAL_MIN=7' "$H/eco.conf" && grep -q '^WAKE_WINDOW=9' "$H/eco.conf" && ok "two settings in one request both take effect" || bad "conf: $(grep -E 'INTERVAL_MIN|WAKE_WINDOW' "$H/eco.conf" | tr '\n' ' ')"
sh "$H/stop_hub.sh" launch >/dev/null 2>&1
