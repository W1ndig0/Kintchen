# Kitchen Hub 10.5: shared helpers, sourced by run_hub.sh, power_loop.sh, stop_hub.sh and the diagnostics
# scripts. Before 10.5 every script carried its own copy of "start the page" and "kill the hub", and the
# copies drifted apart (one killed with -9, one forgot the jobs, one started a second page).
#
# The rules, in one place:
#   * The page is started ONLY by hub_start_page, and only when hub_page_running says it is not running.
#     Starting an app that is already running (or still loading) is what makes the Kindle show
#     "The application could not be started".
#   * "Our" page is the mesquite process the hub started (its pid is kept in .mesquite.pid) or one whose
#     command line names com.custom.kitchenhub. Other mesquite apps (the Kindle's browser) are left alone.
#   * Stopping is TERM first, a wait, and KILL only if TERM didn't work. After any KILL the system state
#     the loop may have changed (powerd paused, wake alarm, CPU governor) is repaired.
HC_DIR="${DIR:-${HUB_DIR:-/mnt/us/extensions/shiftcal}}"
HC_APP="com.custom.kitchenhub"
HC_MESQ_PIDF="$HC_DIR/.mesquite.pid"
HC_LOOP_PIDF="$HC_DIR/.loop.pid"
hc_log() { echo "$(date '+%m-%d %H:%M:%S') [${HC_WHO:-hub}] $*" >> "$HC_DIR/power.log" 2>/dev/null; }

hc_alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
hc_comm() { tr -d '\0' 2>/dev/null < "/proc/$1/comm" || sed -n 's/^Name:[[:space:]]*//p' "/proc/$1/status" 2>/dev/null; }
hc_cmdline() { tr '\0' ' ' 2>/dev/null < "/proc/$1/cmdline"; }

# every pid of a process RUNNING the script or program $1 (its first or second argument is .../$1),
# not processes that merely mention the name (an editor, a grep, a terminal). Not this shell.
hc_pids_matching() {
    for D in /proc/[0-9]*; do
        P=${D#/proc/}
        [ "$P" = "$$" ] && continue
        HA=$(tr '\0' '\n' 2>/dev/null < "$D/cmdline" | head -2)
        for HX in $HA; do case "$HX" in "$1"|*/"$1") echo "$P"; break ;; esac; done
    done
}
# the page listener: "nc -l -p 8765" (busybox applet or a separate nc)
hc_nc_pids() {
    for D in /proc/[0-9]*; do
        P=${D#/proc/}
        case " $(hc_cmdline "$P")" in *" nc -l -p 8765"*|*"/nc -l -p 8765"*) echo "$P" ;; esac
    done
}
# pids of the hub's own page process(es)
hub_page_pids() {
    HP=""
    MP=$(cat "$HC_MESQ_PIDF" 2>/dev/null | tr -cd '0-9')
    if hc_alive "$MP" && [ "$(hc_comm "$MP")" = "mesquite" ]; then HP="$MP"; fi
    for P in $(pidof mesquite 2>/dev/null); do
        [ "$P" = "$MP" ] && continue
        case "$(hc_cmdline "$P")" in *"$HC_APP"*|*"/shiftcal/mesquite"*) HP="$HP $P" ;; esac
    done
    echo $HP
}
hub_page_running() { [ -n "$(hub_page_pids)" ]; }

# Start the page through the Kindle's app manager and remember which mesquite is ours.
# Returns 0 when the page process is up within $1 seconds (default 30), 1 otherwise. Never starts it twice.
hub_start_page() {
    if hub_page_running; then hc_log "page already running ($(hub_page_pids)) - not starting it again"; return 0; fi
    HS_WAIT=${1:-30}
    HS_BEFORE=" $(pidof mesquite 2>/dev/null) "
    lipc-set-prop com.lab126.appmgrd start "app://$HC_APP" 2>/dev/null
    HS_T=0
    while [ "$HS_T" -lt "$HS_WAIT" ]; do
        sleep 1; HS_T=$((HS_T + 1))
        for P in $(pidof mesquite 2>/dev/null); do
            case "$HS_BEFORE" in *" $P "*) case "$(hc_cmdline "$P")" in *"$HC_APP"*) ;; *) continue ;; esac ;; esac
            echo "$P" > "$HC_MESQ_PIDF"
            hc_log "page process $P up after ${HS_T}s: $(hc_cmdline "$P" | cut -c1-120)"
            return 0
        done
    done
    hc_log "the Kindle did not start the page within ${HS_WAIT}s"
    return 1
}

# TERM the given pids, wait up to $1 seconds, then KILL what is left. Prints how many needed KILL.
hc_stop_pids() {
    HT=$1; shift
    [ -n "$*" ] || { echo 0; return; }
    kill "$@" 2>/dev/null
    HW=0
    while [ "$HW" -lt "$HT" ]; do
        HL=""; for P in "$@"; do hc_alive "$P" && HL="$HL $P"; done
        [ -z "$HL" ] && { echo 0; return; }
        sleep 1; HW=$((HW + 1))
    done
    HN=0; for P in "$@"; do hc_alive "$P" && { kill -9 "$P" 2>/dev/null; HN=$((HN + 1)); }; done
    echo "$HN"
}

# all descendants of a pid (children first found, then theirs)
hc_children() { for D in /proc/[0-9]*; do P=${D#/proc/}; [ "$(awk '{print $4}' "$D/stat" 2>/dev/null)" = "$1" ] && echo "$P"; done; }
hc_tree() { for C in $(hc_children "$1"); do hc_tree "$C"; echo "$C"; done; }
# stop a background job and everything it started (curl, sync_data.sh ...), so nothing keeps running
hc_kill_tree() { hc_alive "$1" || return 0; HK="$(hc_tree "$1") $1"; hc_stop_pids 3 $HK >/dev/null; }

# 10.9: the settings-port key. Made once from the Kindle's random source, kept in .port_key (private), and
# given to the page as mesquite/portkey.js. Sets HC_PORT_KEY. run_hub.sh calls it before the page opens, so
# the page always starts with the key; power_loop.sh calls it again (no change if the key exists).
hub_port_key() {
    HC_PORT_KEY=$(tr -cd 'a-f0-9' 2>/dev/null < "$HC_DIR/.port_key" | cut -c1-32)
    if [ ${#HC_PORT_KEY} -lt 32 ]; then
        HC_PORT_KEY=$(head -c 16 /dev/urandom | od -An -v -tx1 2>/dev/null | tr -cd 'a-f0-9' | cut -c1-32)
        [ ${#HC_PORT_KEY} -lt 32 ] && HC_PORT_KEY=$( (date +%s; echo $$; cat /proc/uptime /proc/interrupts 2>/dev/null) | sha256sum | cut -c1-32)
        ( umask 077; echo "$HC_PORT_KEY" > "$HC_DIR/.port_key" )
        hc_log "made a new key for the settings port"
    fi
    HC_PK_JS="window.HUB_PORTKEY=\"$HC_PORT_KEY\";"
    [ "$(cat "$HC_DIR/mesquite/portkey.js" 2>/dev/null)" = "$HC_PK_JS" ] || { echo "$HC_PK_JS" > "$HC_DIR/mesquite/portkey.js.tmp" && mv "$HC_DIR/mesquite/portkey.js.tmp" "$HC_DIR/mesquite/portkey.js"; }
}

# 10.9: the authenticator (TOTP) secret: 20 random bytes as base32, kept in .totp (private). The page gets it
# in mesquite/totp.js (with on:1 once you have added it to your authenticator app and entered a code), and
# checks codes itself. .totp_on marks that setup is finished.
hub_totp_init() {
    HC_TOTP=$(tr -cd 'A-Z2-7' 2>/dev/null < "$HC_DIR/.totp" | cut -c1-32)
    if [ ${#HC_TOTP} -lt 32 ]; then
        HC_TOTP=$(head -c 20 /dev/urandom | od -An -v -tu1 2>/dev/null | awk '
            BEGIN { A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" }
            { for (i = 1; i <= NF; i++) { buf = buf * 256 + $i; bits += 8; while (bits >= 5) { bits -= 5; v = int(buf / 2 ^ bits); buf -= v * 2 ^ bits; out = out substr(A, v + 1, 1) } } }
            END { print out }')
        [ ${#HC_TOTP} -lt 32 ] && return 1
        ( umask 077; echo "$HC_TOTP" > "$HC_DIR/.totp" )
        rm -f "$HC_DIR/.totp_on"
        hc_log "made a new authenticator secret (not set up yet)"
    fi
    HC_TOTP_ON=0; [ -f "$HC_DIR/.totp_on" ] && HC_TOTP_ON=1
    HC_TJ="window.HUB_TOTP={secret:\"$HC_TOTP\",on:$HC_TOTP_ON};"
    [ "$(cat "$HC_DIR/mesquite/totp.js" 2>/dev/null)" = "$HC_TJ" ] || { echo "$HC_TJ" > "$HC_DIR/mesquite/totp.js.tmp" && mv "$HC_DIR/mesquite/totp.js.tmp" "$HC_DIR/mesquite/totp.js"; }
    return 0
}
# 10.9: may this Kindle use the cloud? A first connection needs an authenticator code on the Kindle (.cloud_ok).
# A Kindle that already synced before 10.9 (it has the last copy seen on GitHub) is allowed without asking.
hub_cloud_allowed() {
    [ -f "$HC_DIR/.cloud_ok" ] && return 0
    if [ -s "$HC_DIR/.cloud_remote.tsv" ]; then date +%s > "$HC_DIR/.cloud_ok"; hc_log "cloud: already connected before 10.9 - allowed"; return 0; fi
    return 1
}

# 10.9: set (or with an empty value, remove) one KEY=value line in cloud.conf, keeping every other line.
# Values are checked here (only [A-Za-z0-9_:/.-]) so the file stays safe to source; it stays private.
hub_conf_set() {
    HCF="$HC_DIR/cloud.conf"
    [ -f "$HCF" ] || return 1
    case "$2" in *[!A-Za-z0-9_:/.-]*) return 1 ;; esac
    ( umask 077
      awk -v k="$1" -v v="$2" 'BEGIN { done = 0 }
          { line = $0; sub(/\r$/, "", line) }
          line ~ ("^" k "=") { if (v != "" && !done) { print k "=" v; done = 1 } next }
          { print }
          END { if (v != "" && !done) print k "=" v }' "$HCF" > "$HCF.tmp" ) && mv "$HCF.tmp" "$HCF"
}
# The passphrase a Kindle used before 10.9 when cloud.conf had none. Kept ONLY so lists locked with it can
# still be opened and moved to new keys (Settings > Security > MAKE NEW KEYS). It is public: never choose it.
hc_legacy_pass() { printf '%s' "Holy"; }

# Put back what the loop changes while it runs. Safe to call any time; used after a KILL.
hc_repair_system() {
    PD=$(pidof powerd 2>/dev/null)
    if [ -n "$PD" ]; then kill -CONT $PD 2>/dev/null; else start powerd >/dev/null 2>&1; fi
    for R in /sys/class/rtc/rtc1/wakealarm /sys/class/rtc/rtc0/wakealarm; do [ -w "$R" ] && echo 0 > "$R" 2>/dev/null; done
    G=$(cat "$HC_DIR/.gov_saved" 2>/dev/null | tr -cd 'a-z_')
    if [ -n "$G" ]; then for F in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do [ -w "$F" ] && echo "$G" > "$F" 2>/dev/null; done; rm -f "$HC_DIR/.gov_saved"; fi
}
