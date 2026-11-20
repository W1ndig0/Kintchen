# 10.9: authenticator gate, first cloud connection, new keys, new GitHub token. Run: KH_TESTS=$(pwd) sh t14.sh
. $KH_TESTS/env.sh
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
printf 'PASSPHRASE=old-words-here\nGIST_ID=abc123\nGH_TOKEN=github_pat_OLDOLDOLDOLDOLDOLD\nPAGES_URL=https://x.github.io/k/\n' > "$HUB_DIR/cloud.conf"
sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1
ping_page vp=1x1 >/dev/null; sleep 2
grep -q 'secret:"[A-Z2-7]\{32\}",on:0' "$HUB_DIR/mesquite/totp.js" 2>/dev/null && ok "authenticator secret made before setup (on:0)" || bad "totp.js: $(cat "$HUB_DIR/mesquite/totp.js" 2>/dev/null)"
[ "$(stat -c %a "$HUB_DIR/.totp" 2>/dev/null)" = 600 ] && ok ".totp is private" || bad ".totp mode"
# before the authenticator is set up, nothing security-related is accepted
ping_page "rotate=1&rid=501" >/dev/null; ping_page "cloudok=1&rid=502" >/dev/null; sleep 3
grep -q '^PASSPHRASE=old-words-here' "$HUB_DIR/cloud.conf" && [ ! -f "$HUB_DIR/.cloud_ok" ] && ok "no authenticator yet: new keys and cloud connection refused" || bad "acted without an authenticator"
# the cloud script waits for the code
HUB_DIR="$HUB_DIR" sh "$HUB_DIR/hub_cloud.sh" sync
grep -q 'waiting for the authenticator' "$HUB_DIR/.cloud_status" && ok "cloud sync waits for the authenticator code" || bad "cloud status: $(cat "$HUB_DIR/.cloud_status" 2>/dev/null)"
grep -q 'cok:0' "$HUB_DIR/mesquite/cloud.js" && ok "page told: cloud not allowed yet" || bad "cloud.js cok"
# set up + first connection
ping_page "totpon=1&rid=503" >/dev/null; sleep 2
[ -f "$HUB_DIR/.totp_on" ] && grep -q 'on:1' "$HUB_DIR/mesquite/totp.js" && ok "authenticator set up (on:1)" || bad "totpon not handled"
ping_page "cloudok=1&rid=504" >/dev/null; sleep 2
[ -f "$HUB_DIR/.cloud_ok" ] && grep -q 'cok:1' "$HUB_DIR/mesquite/cloud.js" && ok "first cloud connection allowed" || bad "cloudok not handled"
# new keys
ping_page "rotate=1&rid=505" >/dev/null; sleep 3
P=$(sed -n 's/^PASSPHRASE=//p' "$HUB_DIR/cloud.conf")
echo "$P" | grep -qE '^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$' && ok "new passphrase made (6 groups of 4)" || bad "new passphrase: $P"
[ "$(cat "$HUB_DIR/.pass_old" 2>/dev/null)" = "old-words-here" ] && [ "$(stat -c %a "$HUB_DIR/.pass_old")" = 600 ] && ok "old passphrase kept privately for the switch" || bad ".pass_old"
grep -q '^NTFY_TOPIC=kitchenhub-[0-9a-f]\{20\}$' "$HUB_DIR/cloud.conf" && grep -q '^MON_TOPIC=khscreen-[0-9a-f]\{20\}$' "$HUB_DIR/cloud.conf" && ok "new alert and monitor topics" || bad "topics"
grep -q "pass:\"$P\",pass0:\"old-words-here\",legacy:0" "$HUB_DIR/mesquite/cloud.js" && ok "page gets the new and the old passphrase" || bad "cloud.js: $(head -c 200 "$HUB_DIR/mesquite/cloud.js")"
grep -q '^GIST_ID=abc123' "$HUB_DIR/cloud.conf" && grep -q '^GH_TOKEN=github_pat_OLD' "$HUB_DIR/cloud.conf" && ok "other cloud.conf lines kept" || bad "cloud.conf damaged"
[ "$(stat -c %a "$HUB_DIR/cloud.conf")" = 600 ] && ok "cloud.conf private after the change" || bad "cloud.conf mode"
# new GitHub token from the phone
ping_page "ghtoken=github_pat_NEWNEWNEWNEWNEWNEW_1&rid=506" >/dev/null; sleep 2
grep -q '^GH_TOKEN=github_pat_NEWNEWNEWNEWNEWNEW_1$' "$HUB_DIR/cloud.conf" && ok "new GitHub token stored" || bad "token not replaced"
ping_page "ghtoken=bad%3Btoken%24%28x%29&rid=507" >/dev/null; sleep 2
grep -q '^GH_TOKEN=github_pat_NEWNEWNEWNEWNEWNEW_1$' "$HUB_DIR/cloud.conf" && ok "a token with odd characters is refused" || bad "odd token accepted"
# finish
ping_page "keysdone=1&rid=508" >/dev/null; sleep 2
[ ! -f "$HUB_DIR/.pass_old" ] && grep -q 'pass0:""' "$HUB_DIR/mesquite/cloud.js" && ok "FINISH forgets the old passphrase" || bad "keysdone"
sh "$HUB_DIR/stop_hub.sh" launch >/dev/null 2>&1
# a Kindle that synced before 10.9 is allowed without asking
rm -f "$HUB_DIR/.cloud_ok"; echo '#hub v1' > "$HUB_DIR/.cloud_remote.tsv"
HUB_DIR="$HUB_DIR" sh -c '. "$HUB_DIR/hub_common.sh"; hub_cloud_allowed' && [ -f "$HUB_DIR/.cloud_ok" ] && ok "synced before 10.9: allowed without a code" || bad "pre-10.9 Kindle blocked"
echo "--- power.log"; grep -E 'authenticator|cloud:|keys|token' "$HUB_DIR/power.log" | tail -8
