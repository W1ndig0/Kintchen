# 11.2.2: hub_items.js is only restamped when the lists, the pending flag or the sync result really changed
# (an unchanged sync used to make the page redraw all its tiles). Run: KH_TESTS=$(pwd) sh t32.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
J="$HUB_DIR/mesquite/hub_items.js"; run() { HUB_DIR="$HUB_DIR" sh "$HUB_DIR/hub_cloud.sh" js; }
printf '1000\tmilk\tshop\tactive\tMilk\n' > "$HUB_DIR/hub.tsv"
echo "ok 100" > "$HUB_DIR/.cloud_status"; : > "$HUB_DIR/hub.remote"
cp "$HUB_DIR/hub.tsv" "$HUB_DIR/hub.remote"
run; A1=$(sed -n 's/.*at: \([0-9]*\),.*/\1/p' "$J" | head -1); [ -n "$A1" ] && ok "first write" || { bad "no file: $(cat "$J" 2>/dev/null)"; }
# same lists, a newer "ok <time>": the file must stay byte-for-byte the same
sleep 1; echo "ok 200" > "$HUB_DIR/.cloud_status"; cp "$J" "$KT/before.js"; run
cmp -s "$J" "$KT/before.js" && ok "unchanged sync leaves hub_items.js alone (page keeps its screen)" || bad "restamped: $(head -1 "$J")"
# a new item: "at" must move forward
printf '1001\teggs\tshop\tactive\tEggs\n' >> "$HUB_DIR/hub.tsv"; cp "$HUB_DIR/hub.tsv" "$HUB_DIR/hub.remote"; run
A2=$(sed -n 's/.*at: \([0-9]*\),.*/\1/p' "$J" | head -1)
[ "$A2" -gt "$A1" ] && grep -q 'Eggs' "$J" && ok "a changed list gets a newer at ($A1 -> $A2)" || bad "at $A1 -> $A2"
# a second change inside the same second still gets a newer at
printf '1002\tjam\tshop\tactive\tJam\n' >> "$HUB_DIR/hub.tsv"; cp "$HUB_DIR/hub.tsv" "$HUB_DIR/hub.remote"; run
A3=$(sed -n 's/.*at: \([0-9]*\),.*/\1/p' "$J" | head -1); [ "$A3" -gt "$A2" ] && ok "two changes in one second still differ ($A2 -> $A3)" || bad "at $A2 -> $A3"
# pending flips (local changed, not on the PC yet)
printf '1003\ttea\tshop\tactive\tTea\n' >> "$HUB_DIR/hub.tsv"; run
grep -q 'pending: 1' "$J" && ok "pending change rewrites the file" || bad "pending: $(head -1 "$J")"
# the sync result changes (ok -> an error): rewrite
cp "$HUB_DIR/hub.tsv" "$HUB_DIR/hub.remote"; run; A4=$(sed -n 's/.*at: \([0-9]*\),.*/\1/p' "$J" | head -1)
echo "the PC didn't answer (is it on? same Wi-Fi?)" > "$HUB_DIR/.cloud_status"; run
grep -q "st: \"the PC didn't answer" "$J" && ok "an error is shown (file rewritten)" || bad "st: $(head -1 "$J")"
ls "$HUB_DIR/mesquite" | grep -q 'hub_items.js.b' && bad "temp file left" || ok "no temp files left"
