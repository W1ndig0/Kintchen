/* Kitchen Hub v11 - the list store on the PC.
 * One plain text file (hub.tsv) in the same line format as the gist used (see cloud/hubdata.js).
 * Every change is a merge (newest line per id wins), written atomically (temp file + rename),
 * and a copy of the previous version is kept as hub.tsv.bak so a bad write can be undone by hand. */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const HubData = require("../../../cloud/hubdata.js");

function atomicWrite(file, text) {
    const tmp = file + ".tmp" + process.pid;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
}

class Store {
    constructor(dir) {
        this.dir = dir;
        fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, "hub.tsv");
        if (!fs.existsSync(this.file)) atomicWrite(this.file, HubData.HEADER + "\n");
        this.text = HubData.merge([fs.readFileSync(this.file, "utf8")], Date.now());
        this.listeners = [];
    }
    etag() { return '"' + crypto.createHash("sha256").update(this.text).digest("hex").slice(0, 16) + '"'; }
    items() { return HubData.items(this.text); }
    // lines: a store text or an array of item lines -> true when something changed
    merge(lines, now) {
        const next = HubData.merge([this.text, lines], now || Date.now());
        if (next === this.text) return false;
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".bak");
        atomicWrite(this.file, next);
        this.text = next;
        this.listeners.forEach(f => { try { f(); } catch (e) {} });
        return true;
    }
    onChange(f) { this.listeners.push(f); }
}
module.exports = { Store, atomicWrite };
