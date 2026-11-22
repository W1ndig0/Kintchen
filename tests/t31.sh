# 11.2: the battery settings move: an existing eco.conf gets night clock "hour", the PC package every 2 h and lists on
# button press once (ECO_V=112 written), and a later change by the owner is kept. Run: KH_TESTS=$(pwd) sh t31.sh
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d /tmp/kh31.XXXXXX)
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
# just the two functions from the loop
awk '/^load_conf\(\) \{/,/^\}/' "$R/kindle/shiftcal/power_loop.sh" > "$T/f.sh"; awk '/^save_conf\(\) \{/,/^\}/' "$R/kindle/shiftcal/power_loop.sh" >> "$T/f.sh"
CONF="$T/eco.conf"; MIN_WINDOW=120
printf 'NIGHT_CLOCK=same\nSYNC_MODE=manual\nLISTS_ON_WAKE=0\nWX_ANIM=1\n' > "$CONF"
. "$T/f.sh"
load_conf; [ "$ECO_MOVED" = "1" ] && save_conf
grep -q '^NIGHT_CLOCK=hour$' "$CONF" && grep -q '^SYNC_MODE=2$' "$CONF" && grep -q '^LISTS_ON_WAKE=1$' "$CONF" && grep -q '^ECO_V=112$' "$CONF" \
    && ok "an old eco.conf moves to the 11.2 battery settings once" || bad "moved: $(tr '\n' ' ' < "$CONF")"
grep -q '^WX_ANIM=1$' "$CONF" && ok "other settings are kept" || bad "WX_ANIM lost"
sed -i 's/^NIGHT_CLOCK=hour$/NIGHT_CLOCK=same/' "$CONF"; ECO_MOVED=""
load_conf; [ "$NIGHT_CLOCK" = "same" ] && [ -z "$ECO_MOVED" ] && ok "a later change by the owner is kept (not moved again)" || bad "night clock $NIGHT_CLOCK moved=$ECO_MOVED"
grep -q 'is_night_at "$(date +%s)" && play_wx_anim' "$R/kindle/shiftcal/power_loop.sh" && ok "no weather animation at night" || bad "animation at night"
rm -rf "$T"
