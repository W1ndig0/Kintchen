# 10.9: books locked with the passphrase from BEFORE a key change still open on the Kindle.
# Run: KH_TESTS=$(pwd) sh t13.sh   (needs node and openssl)
[ -n "$KH_TESTS" ] || KH_TESTS=$(pwd)
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
KT=$(mktemp -d /tmp/khbooks.XXXX); cp -r "$KH_TESTS/../kindle/shiftcal" "$KT/hub"; H="$KT/hub"; mkdir -p "$KT/cloud" "$KT/lib"
# three books: locked with the old passphrase, with the new one, and with one the Kindle doesn't know
node -e '
const crypto = require("crypto"), fs = require("fs");
function key(p) { let k = Buffer.from("kitchenhub|" + p); for (let i = 0; i < 1000; i++) k = crypto.createHash("sha256").update(k).digest(); return crypto.createHash("sha256").update(Buffer.concat([k, Buffer.from("books")])).digest(); }
for (const [id, pass] of [["b1", "old-pass"], ["b2", "NEW-PASS-1234"], ["b3", "someone-else"]]) {
  const buf = Buffer.from("Book " + id + " " + "x".repeat(3000)), iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-ctr", key(pass), iv), ct = Buffer.concat([c.update(buf), c.final()]);
  fs.writeFileSync(process.argv[1] + "/bk_" + id + ".p0", ct.toString("base64").replace(/(.{76})/g, "$1\n"));
  fs.writeFileSync(process.argv[1] + "/bk_" + id + ".meta", "txt " + buf.length + " " + crypto.createHash("sha256").update(buf).digest("hex") + " 1 a1 " + iv.toString("hex") + "\n");
}' "$KT/cloud"
printf 'PASSPHRASE=NEW-PASS-1234\nPASSPHRASE_OLD=old-pass\n' > "$H/cloud.conf"
printf 'b1\told.txt\nb2\tnew.txt\nb3\tother.txt\n' > "$H/.books_want"
HUB_DIR="$H" HUB_LIB="$KT/lib" BOOKS_URL_TEST="file://$KT/cloud/" sh "$H/hub_books.sh"
HUB_DIR="$H" HUB_LIB="$KT/lib" BOOKS_URL_TEST="file://$KT/cloud/" sh "$H/hub_books.sh"      # 2 books per run
grep -q '^Book b1 ' "$KT/lib/old.txt" 2>/dev/null && ok "book locked with the OLD passphrase opened" || bad "old-passphrase book not opened"
grep -q '^Book b2 ' "$KT/lib/new.txt" 2>/dev/null && ok "book locked with the NEW passphrase opened" || bad "new-passphrase book not opened"
[ -f "$KT/lib/other.txt" ] && bad "a book with an unknown passphrase was written" || ok "unknown passphrase: nothing written"
grep -q '"b3":"locked with a passphrase this Kindle doesn.t have"' "$H/mesquite/books.js" 2>/dev/null && ok "unknown passphrase: clear message for the page" || bad "no clear message ($(cat "$H/mesquite/books.js" 2>/dev/null | head -c 300))"
[ "$(stat -c %a "$H/.books/keys" 2>/dev/null)" = 600 ] && ok "cached book keys are private" || bad "book key cache mode $(stat -c %a "$H/.books/keys" 2>/dev/null)"
# a Kindle with no PASSPHRASE in cloud.conf still opens books locked with the pre-10.9 built-in one
rm -rf "$KT/lib"/* "$H/.books_have" "$H/.books"; : > "$H/cloud.conf"
LEG=$(HC_DIR="$H" sh -c '. "$1/hub_common.sh"; hc_legacy_pass' _ "$H")
node -e '
const crypto = require("crypto"), fs = require("fs");
function key(p) { let k = Buffer.from("kitchenhub|" + p); for (let i = 0; i < 1000; i++) k = crypto.createHash("sha256").update(k).digest(); return crypto.createHash("sha256").update(Buffer.concat([k, Buffer.from("books")])).digest(); }
const buf = Buffer.from("Book b4 legacy"), iv = crypto.randomBytes(16), c = crypto.createCipheriv("aes-256-ctr", key(process.argv[2]), iv), ct = Buffer.concat([c.update(buf), c.final()]);
fs.writeFileSync(process.argv[1] + "/bk_b4.p0", ct.toString("base64"));
fs.writeFileSync(process.argv[1] + "/bk_b4.meta", "txt " + buf.length + " " + crypto.createHash("sha256").update(buf).digest("hex") + " 1 a1 " + iv.toString("hex") + "\n");' "$KT/cloud" "$LEG"
printf 'b4\tlegacy.txt\n' > "$H/.books_want"
HUB_DIR="$H" HUB_LIB="$KT/lib" BOOKS_URL_TEST="file://$KT/cloud/" sh "$H/hub_books.sh"
grep -q '^Book b4 legacy' "$KT/lib/legacy.txt" 2>/dev/null && ok "no PASSPHRASE in cloud.conf: pre-10.9 locked book still opens" || bad "legacy book not opened"
echo "--- sync.log"; tail -5 "$H/sync.log"
rm -rf "$KT"
