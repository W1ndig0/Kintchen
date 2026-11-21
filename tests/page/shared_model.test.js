// The list model exists FOUR times: in the Kindle page, in hubdata.js (phone), in cloud/hubdata.js and as
// awk (hub_merge.awk, used by the Kindle's shell scripts). If they ever drift apart, two devices quietly
// keep different lists, or something locked on one will not open on the other. This checks they agree.
// Run: node tests/page/shared_model.test.js
const fs = require("fs"), cp = require("child_process"), crypto = require("crypto"), os = require("os"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); }
function block(file, name) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const re = new RegExp("^var " + name + " = \\(function\\(\\) \\{[\\s\\S]*?^\\}\\)\\(\\);", "m");
    const m = re.exec(src);
    return m ? m[0] : null;
}
function load(code, name) { return new Function(code + "; return " + name + ";")(); }

// ---- 1. the parts that must be character for character the same
for (const name of ["HubData", "HubCrypt", "HubCal", "HubPantry"]) {
    const a = block("kindle/shiftcal/mesquite/index.html", name), b = block("hubdata.js", name);
    ok(a && b && a === b, name + " is the same in the Kindle page and hubdata.js");
}
ok(fs.readFileSync(path.join(ROOT, "hubdata.js"), "utf8") === fs.readFileSync(path.join(ROOT, "cloud/hubdata.js"), "utf8"),
   "hubdata.js is the same for the phone and the cloud");

// ---- 2. the crypto: the page's copy is written differently, so check what it DOES
const P = load(block("kindle/shiftcal/mesquite/index.html", "HubCrypt"), "HubCrypt");
const S = load(block("hubdata.js", "HubCrypt"), "HubCrypt");
let bad = 0;
for (let L = 0; L <= 600; L++) {            // every message-block boundary
    const s = "a".repeat(L);
    const ref = crypto.createHash("sha256").update(s, "utf8").digest("hex");
    if (P.hex(P.sha256(P.utf8(s))) !== ref || S.hex(S.sha256(S.utf8(s))) !== ref) bad++;
}
ok(bad === 0, "both sha256 copies match a real sha256 at every length 0-600");
let interop = 0;
for (const text of ["milk", "a", "", "café ☕ ".repeat(20), "x".repeat(500), "tab\tand\nnewline"]) {
    try {
        if (S.unlockAny(P.lock(text, "TEST-PASS-1234"), ["TEST-PASS-1234"]) !== text) interop++;
        if (P.unlockAny(S.lock(text, "TEST-PASS-1234"), ["TEST-PASS-1234"]) !== text) interop++;
    } catch (e) { interop++; }
}
ok(interop === 0, "anything locked on the Kindle opens on the phone and the other way round");

// ---- 3. the shell merge (awk) must give the same answer as the JavaScript one
const HubData = load(block("hubdata.js", "HubData"), "HubData");
const NOW = 1763600000000;
function rnd(n) { return Math.floor(Math.random() * n); }
const kinds = ["shop", "msg", "cmd", "note", "book"], states = ["open", "done", "del"];
const lines = [];
for (let i = 0; i < 400; i++) {
    const id = "i" + rnd(40);
    const ts = NOW - rnd(60) * 86400000 - rnd(1000);        // some older than the 30-day tombstone cut
    const st = states[rnd(3)];
    const text = ["milk", "eggs 2%", "a b c", "x".repeat(rnd(40)), "with|pipe", "with\\slash"][rnd(6)];
    lines.push(ts + "\t" + id + "\t" + kinds[rnd(5)] + "\t" + st + "\t" + text);
}
// a few lines that must be thrown away by both
lines.push("not a line", "123\tid\tkind\tbogus\ttext", "\t\t\t\t", "12x\tid\tshop\topen\ttext");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khmerge-"));
const f1 = path.join(dir, "a.tsv");
fs.writeFileSync(f1, "#hub v1\n" + lines.join("\n") + "\n");
const js = HubData.merge([fs.readFileSync(f1, "utf8")], NOW);
const out = path.join(dir, "out.tsv");
cp.execFileSync("sh", [path.join(ROOT, "kindle/shiftcal/hub_merge.sh"), out, f1], { env: { ...process.env, TZ: "PCT7" } });
// the shell merge stamps "now" from the clock; give the JS one the same instant by re-running with it
const shell = fs.readFileSync(out, "utf8");
const jsNow = HubData.merge([fs.readFileSync(f1, "utf8")], Date.now());
ok(shell === jsNow, "the shell merge gives exactly the same file as the JavaScript merge (" + shell.split("\n").length + " lines)");
if (shell !== jsNow) {
    const a = shell.split("\n"), b = jsNow.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { console.log("  first difference on line " + (i + 1) + "\n   shell: " + a[i] + "\n   js:    " + b[i]); break; }
}
ok(js.indexOf("not a line") < 0 && js.indexOf("bogus") < 0, "both throw away lines that are not list items");

console.log((fails ? "FAILED " + fails + " of " : "all ") + checks + " checks");
process.exit(fails ? 1 : 0);
