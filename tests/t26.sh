# 10.10.5: the editing screen (stuck overlay, invisible chips, hint position, CHEVR labels, clipped masthead), in the old-WebKit page.
# Run: KH_TESTS=$(pwd) sh t26.sh   (about 15 seconds). Needs phantomjs (PATH, or /opt/npm-tools/node_modules/.bin).
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d /tmp/khedit.XXXXXX)
PATH="$PATH:/opt/npm-tools/node_modules/.bin"; command -v phantomjs >/dev/null || { echo "FAIL no phantomjs"; exit 1; }
cp -r "$R/kindle/shiftcal/mesquite" "$T/mq" && node "$R/tests/page/make_fixture.js" "$T/mq" 3 >/dev/null
N=$(date +%s)
cat > "$T/mq/state.js" <<STATE
window.HUB_STATE = { v: "10.10.5", autoUpd: 0, updPending: 0, now: $N, sleeping: 0, awakeUntil: $((N + 900)), wakeReason: "start", lastUpdated: "9:01 AM",
  lastSyncEpoch: $N, nextWake: "--:--", nextWakeEpoch: 0, intervalMin: 5, wakeWindow: 120, setScreensaver: 0, screensaverMode: "off", pillowDisabled: 2,
  battery: "80", batteryHoursLeft: 0, charging: 0, lastRid: 0, booted: 1, smart: 1, homeMin: 15, awayMin: 120, nightMin: 180, nightFrom: 23, nightTo: 6,
  where: "home", aways: 0, snoozeUntil: 0, quick: 0, quickWake: 1, clockMode: "15", frontlight: -1, rate7: 0, hours7: 0, wakesPerDay: 0,
  sleepClock: "min", nightClock: "same", nightDeghost: 1, hourly: 1, wxAnim: 0, timerTick: 0, timerEnd: 0, syncMode: "manual", editPush: "now",
  listsOnWake: 0, daily: 1, dailyHour: 3, lowSaver: 1, clockDraw: "auto", clockBy: "page", dataN: 0 };
STATE
OPENSSL_CONF=/dev/null timeout 90 phantomjs --local-to-remote-url-access=yes --web-security=no "$R/tests/page/edit_bar.phantom.js" "$T/mq" 2>&1 | grep -v 'libpng'
RC=$?; rm -rf "$T"
