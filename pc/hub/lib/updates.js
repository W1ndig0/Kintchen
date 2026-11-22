/* Kitchen Hub v11 - fridge updates from the PC (no GitHub): the same manifest kindle/make_manifest.sh writes,
 * made here from the PC's own copy of the kit (kindle/shiftcal), so the fridge updates from the PC.
 * Line 1 "version X", then "sha256 md5 size path" for every file, sorted like LC_ALL=C sort. */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const SKIP = /^(cloud\.conf|hub\.tsv|eco\.conf|stocks\.conf|news\.conf|mesquite\/(data|state|hub_items|cloud|battery|web|update|books)\.js)$/;
function walk(dir, rel, out) {
    fs.readdirSync(path.join(dir, rel)).forEach(n => {
        const r = rel ? rel + "/" + n : n, st = fs.statSync(path.join(dir, r));
        if (st.isDirectory()) walk(dir, r, out); else if (st.isFile()) out.push(r);
    });
    return out;
}
let cache = { key: "", text: "" };
function manifest(shiftcal) {
    const files = walk(shiftcal, "", []).filter(f => !SKIP.test(f) && !/(^|\/)\./.test(f)).sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
    const key = files.map(f => f + ":" + fs.statSync(path.join(shiftcal, f)).mtimeMs).join("|");
    if (key === cache.key) return cache.text;
    const v = (/^VERSION="([^"]*)"/m.exec(fs.readFileSync(path.join(shiftcal, "power_loop.sh"), "utf8")) || [])[1] || "";
    let t = "version " + v + "\n";
    files.forEach(f => { const b = fs.readFileSync(path.join(shiftcal, f));
        t += crypto.createHash("sha256").update(b).digest("hex") + " " + crypto.createHash("md5").update(b).digest("hex") + " " + b.length + " " + f + "\n"; });
    cache = { key, text: t };
    return t;
}
module.exports = { manifest };
