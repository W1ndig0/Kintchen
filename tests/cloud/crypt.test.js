// 10.9: the lock is implemented twice in JS (cloud/hubdata.js for the phone, cloud and TV; a copy inside the
// Kindle page). Both must lock, unlock, seal and unseal each other's output. Run: node tests/cloud/crypt.test.js
const fs = require("fs"), path = require("path");
const C = require(path.join(__dirname, "../../cloud/hubdata.js")).HubCrypt;
const page = fs.readFileSync(path.join(__dirname, "../../kindle/shiftcal/mesquite/index.html"), "utf8");
const a = page.indexOf("var HubCrypt = (function"), b = page.indexOf("})();", a) + 5;
const K = new Function(page.slice(a, b) + "; return HubCrypt;")();
let fails = 0; function check(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const txt = "milk|p1|2|2% — ünïcode ✓";
check(K.unlock(C.lock(txt, "pass one"), "pass one") === txt, "cloud lock -> Kindle unlock");
check(C.unlock(K.lock(txt, "pass one"), "pass one") === txt, "Kindle lock -> cloud unlock");
check(C.unlock(C.lock(txt, "a"), "b") === null, "wrong passphrase -> null");
check(C.unlock("plain text", "x") === "plain text", "plain text passes through");
check(C.unlockAny(C.lock(txt, "old"), ["new", "old"]) === txt && K.unlockAny(K.lock(txt, "old"), ["new", "old"]) === txt, "unlockAny opens text locked with the old key (both copies)");
check(C.unlockAny(C.lock(txt, "x"), ["new", "old"]) === null, "unlockAny: neither key -> null");
const code = K.pairCode(10, "secret-seed");
check(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(code), "pairing code: 10 characters, no look-alikes (" + code + ")");
const codes = {}; for (let i = 0; i < 500; i++) codes[K.pairCode(10, "seed")] = 1;
check(Object.keys(codes).length === 500, "500 pairing codes, all different (no crypto in the Kindle path either)");
const payload = { g: "abc123", t: "github_pat_XYZ", k: "new pass", k0: "old pass", w: "p2" };
const blob = K.seal(payload, code);
const lower = code.toLowerCase().replace(/(.{5})/, "$1-");
check(JSON.stringify(C.unseal(blob, lower)) === JSON.stringify(payload), "Kindle seal -> phone unseal (code typed in lower case with a dash)");
check(C.unseal(blob, "WRONGCODE2") === null, "wrong code -> nothing");
check(blob.indexOf("github_pat") < 0 && blob.indexOf("abc123") < 0, "the sealed link shows no token or gist");
check(JSON.stringify(K.unseal(C.seal(payload, code), code)) === JSON.stringify(payload), "phone seal -> Kindle unseal");
check(C.unseal("not a blob", code) === null && C.unseal(C.lock("{}", "x"), code) === null, "junk -> nothing");
// the Kindle's old browser has no crypto.getRandomValues: same code with crypto hidden
const K2 = new Function("var crypto = undefined, window = {};" + page.slice(a, b) + "; return HubCrypt;")();
const c2 = {}; for (let i = 0; i < 500; i++) c2[K2.pairCode(10, "port-key-secret")] = 1;
check(Object.keys(c2).length === 500 && /^[2-9A-Z]{10}$/.test(Object.keys(c2)[0]), "no secure random source: codes still all different");
check(K2.pairCode(10, "a") !== K2.pairCode(10, "a"), "no secure random source: same seed, different codes");
process.exit(fails ? 1 : 0);
