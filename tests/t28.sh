# 10.10.5: the standby page's layout at every rotation (title cut, caption under the picture, overlaps, and the places told to the loop).
# Run: KH_TESTS=$(pwd) sh t28.sh   (about 1 minute). Needs phantomjs (PATH, or /opt/npm-tools/node_modules/.bin).
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d /tmp/khstby.XXXXXX)
PATH="$PATH:/opt/npm-tools/node_modules/.bin"; command -v phantomjs >/dev/null || { echo "FAIL no phantomjs"; exit 1; }
cp -r "$R/kindle/shiftcal/mesquite" "$T/mq" && node "$R/tests/page/make_fixture.js" "$T/mq" 3 >/dev/null
mkdir -p "$T/mq/art" && tar -xf "$R/kindle/shiftcal/sleepart.tar" -C "$T/mq/art" || { echo "FAIL could not unpack the sleep pictures"; exit 1; }
N=$(date +%s)
cat > "$T/mq/state.js" <<STATE
window.HUB_STATE = { v: "10.10.5", autoUpd: 0, updPending: 0, now: $N, sleeping: 1, awakeUntil: $((N - 30)), wakeReason: "start", lastUpdated: "9:01 AM",
  lastSyncEpoch: $N, nextWake: "--:--", nextWakeEpoch: 0, intervalMin: 5, wakeWindow: 120, setScreensaver: 0, screensaverMode: "off", pillowDisabled: 2,
  battery: "80", batteryHoursLeft: 0, charging: 0, lastRid: 0, booted: 1, smart: 1, homeMin: 15, awayMin: 120, nightMin: 180, nightFrom: 23, nightTo: 6,
  where: "home", aways: 0, snoozeUntil: 0, quick: 0, quickWake: 1, clockMode: "15", frontlight: -1, rate7: 0, hours7: 0, wakesPerDay: 0,
  sleepClock: "min", nightClock: "same", nightDeghost: 1, hourly: 1, wxAnim: 0, timerTick: 0, timerEnd: 0, syncMode: "manual", editPush: "now",
  listsOnWake: 0, daily: 1, dailyHour: 3, lowSaver: 1, clockDraw: "auto", clockBy: "loop", dataN: 0 };
STATE
FAILS=0
for ROT in 0 90 180 270; do for V in plain crowded; do
  OPENSSL_CONF=/dev/null timeout 60 phantomjs --local-to-remote-url-access=yes --web-security=no "$R/tests/page/standby_layout.phantom.js" "$T/mq" "$ROT" "$V" 2>&1 | grep -v 'libpng\|^clk$\|^wx$' | tee -a "$T/out.txt"
done; done
grep -c '^FAIL' "$T/out.txt" | grep -q '^0$' || FAILS=1
rm -rf "$T"; exit $FAILS
