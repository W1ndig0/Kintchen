# Kitchen Hub launcher/loop/updater tests on Linux (fake Kindle commands in stub/). Run: KH_TESTS=$(pwd) sh t2.sh
[ -n "$KH_TESTS" ] || KH_TESTS=$(pwd)
export KH_TESTS
# usage: . env.sh   -> fresh test folder in $KT, hub copy in $HUB_DIR
export STUB=$KH_TESTS/stub
chmod +x "$STUB"/* "$KH_TESTS"/fake/* 2>/dev/null     # GitHub web uploads drop the executable flag
# 10.10.3: stop anything a previous test left running. On a Kindle there is only ever one hub, so
# run_hub.sh refuses to start while ANY power_loop.sh is alive - a loop left behind by the test before
# made the next test fail for no reason (t2 "starts=0"), which hid real failures.
# Only a process whose first arguments ARE the script counts (never this shell, which has the name in
# its own command line).
kh_stray() {
    for d in /proc/[0-9]*; do
        p=${d#/proc/}
        [ "$p" = "$$" ] && continue
        for a in $(tr '\0' '\n' 2>/dev/null < "$d/cmdline" | head -2); do      # the first two, like hc_pids_matching: a path passed as an ARGUMENT is not the script being run
            case "$a" in */power_loop.sh|power_loop.sh|*/stub/mesquite) echo "$p"; break ;; esac
        done
    done
}
for p in $(kh_stray); do kill "$p" 2>/dev/null; done
sleep 1
for p in $(kh_stray); do kill -9 "$p" 2>/dev/null; done
export KT=$(mktemp -d /tmp/khtest.XXXX)
cp -r $KH_TESTS/../kindle/shiftcal "$KT/hub"
export HUB_DIR="$KT/hub" HUB_TEST=1 HUB_APPREG="$KT/appreg.db" HUB_SYS_POWER_STATE="$KT/power_state"
export HUB_RTC_CANDIDATES="$KT/rtc0" HUB_SUSPEND_CMD="sleep 2" HUB_SS_DIR="$KT/ss" HUB_MIN_WINDOW=4 HUB_BOOT_WAIT=${HUB_BOOT_WAIT:-12}
: > "$KT/appreg.db"; : > "$KT/rtc0"; : > "$KT/lipc.log"
printf 'INTERVAL_MIN=5\nWAKE_WINDOW=4\nWIFI_TIMEOUT=2\nSCREENSAVER_MODE=off\nPILLOW_DISABLE=2\nCLOUD_ON_WAKE=0\nAUTO_UPDATE=0\n' > "$HUB_DIR/eco.conf"
export PATH="$STUB:$PATH"
ping_page() { busybox wget -q -T 3 -O- "http://127.0.0.1:8765/save?$1&t=$(date +%s%N)" 2>/dev/null; }
starts() { grep -c 'appmgrd start app://com.custom.kitchenhub' "$KT/lipc.log"; }
doubles() { grep -c DOUBLE_START "$KT/lipc.log"; }
loops() { for d in /proc/[0-9]*; do case "$(tr '\0' ' ' 2>/dev/null < $d/cmdline)" in *"$HUB_DIR/power_loop.sh"*) echo ${d#/proc/} ;; esac; done | wc -l; }
pages() { $KH_TESTS/stub/pidof mesquite | wc -w; }
waitfor() { i=0; while [ $i -lt $2 ]; do eval "$1" && return 0; sleep 1; i=$((i+1)); done; return 1; }
loops() { for d in /proc/[0-9]*; do case "$(tr '\0' ' ' 2>/dev/null < $d/cmdline)" in *"$HUB_DIR/power_loop.sh"*) pp=$(awk '{print $4}' $d/stat 2>/dev/null); case "$(tr '\0' ' ' 2>/dev/null < /proc/$pp/cmdline)" in *"$HUB_DIR/power_loop.sh"*) ;; *) echo ${d#/proc/} ;; esac ;; esac; done | wc -l; }
ping_page() { for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do R=$(busybox wget -q -T 2 -O- "http://127.0.0.1:8765/save?$1&pk=$(cat "$HUB_DIR/.port_key" 2>/dev/null)&t=$(date +%s%N)" 2>/dev/null); [ "$R" = ok ] && { echo ok; return 0; }; sleep 1; done; echo none; }
# 10.9: the same request WITHOUT the settings-port key (a stranger on the Wi-Fi)
ping_nokey() { for i in 1 2 3 4 5 6 7 8 9 10; do R=$(busybox wget -q -T 2 -O- "http://127.0.0.1:8765/save?$1&t=$(date +%s%N)" 2>/dev/null); [ "$R" = ok ] && { echo ok; return 0; }; sleep 1; done; echo none; }
