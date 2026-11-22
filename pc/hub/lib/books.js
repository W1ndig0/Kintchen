/* Kitchen Hub v11 - the book folder on the PC. Every book file in the folder goes to the fridge Kindle's library at
 * its next sync; take it out of the folder and it leaves the Kindle.
 *   - each file becomes a "book" item in the list (want = kindle), so the fridge's Books screen and its existing
 *     downloader (hub_books.sh) work unchanged
 *   - files are served in the same layout the book gist used: bk_<id>.meta ("ext size sha256 1") + bk_<id>.p0
 *     (base64), at a long random link on the home network
 *   - EPUB is converted to AZW3 with Calibre's ebook-convert when it is installed (the Kindle's own reader can't
 *     open EPUB); without Calibre the EPUB is sent as it is
 * "Title - Author.epub" gives the title and author; otherwise the file name is the title. */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const HubData = require("../../../cloud/hubdata.js"), { HubCal } = HubData;
const { atomicWrite } = require("./store.js");
const EXT = /\.(azw3|azw|mobi|pdf|txt|epub|prc|kfx)$/i;

function findCalibre() {
    const c = [process.env.EBOOK_CONVERT, "ebook-convert", "C:\\Program Files\\Calibre2\\ebook-convert.exe", "C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe"].filter(Boolean);
    for (const x of c) { try { cp.execFileSync(x, ["--version"], { stdio: "ignore", timeout: 20000, windowsHide: true }); return x; } catch (e) {} }
    return "";
}

class Books {
    constructor(opts) {
        this.dir = opts.booksDir; this.data = opts.dataDir; this.store = opts.store; this.log = opts.log || (() => {});
        this.cache = path.join(this.data, "bookcache"); this.file = path.join(this.data, "books.json");
        this.convert = opts.convert === undefined ? null : opts.convert;          // null = look for Calibre once
        fs.mkdirSync(this.dir, { recursive: true }); fs.mkdirSync(this.cache, { recursive: true });
        try { this.known = JSON.parse(fs.readFileSync(this.file, "utf8")) || {}; } catch (e) { this.known = {}; }
    }
    save() { atomicWrite(this.file, JSON.stringify(this.known, null, 1)); }
    // look at the folder; returns the number of changes
    scan(now) {
        now = now || Date.now();
        const seen = {}, lines = []; let n = 0;
        const files = fs.readdirSync(this.dir).filter(f => EXT.test(f) && fs.statSync(path.join(this.dir, f)).isFile());
        for (const f of files) {
            const id = "b" + crypto.createHash("sha1").update(f.toLowerCase()).digest("hex").slice(0, 14);
            const st = fs.statSync(path.join(this.dir, f)); seen[id] = 1;
            const k = this.known[id];
            if (k && k.mtime === st.mtimeMs && k.srcSize === st.size && fs.existsSync(k.path)) continue;
            const b = this.prepare(id, f, st);
            if (!b) continue;
            this.known[id] = b; n++;
            const m = /^(.*?)\s+-\s+(.+)$/.exec(f.replace(EXT, ""));
            const day = new Date(now - 7 * 3600000).toISOString().slice(0, 10);
            lines.push(HubData.makeLine(now, id, "book", "open", HubCal.recText("book", { title: (m ? m[1] : f.replace(EXT, "")).slice(0, 70), author: m ? m[2].slice(0, 30) : "",
                ext: b.ext, size: b.size, want: "kindle", src: "pc", added: day, conv: b.conv })));
        }
        Object.keys(this.known).forEach(id => {
            if (seen[id]) return;
            const k = this.known[id];
            lines.push(HubData.makeLine(now, id, "book", "del", k.text || "removed"));
            if (k.path && k.path.startsWith(this.cache)) { try { fs.unlinkSync(k.path); } catch (e) {} }
            delete this.known[id]; n++;
        });
        if (n) { this.store.merge(lines, now); this.save(); this.log("books: " + n + " change(s) in the book folder"); }
        return n;
    }
    prepare(id, f, st) {
        let p = path.join(this.dir, f), ext = (EXT.exec(f)[1] || "").toLowerCase(), conv = "";
        if (ext === "epub") {
            if (this.convert === null) this.convert = findCalibre();
            if (this.convert) {
                const out = path.join(this.cache, id + ".azw3");
                try { cp.execFileSync(this.convert, [p, out], { stdio: "ignore", timeout: 300000, windowsHide: true }); } catch (e) {}
                if (fs.existsSync(out) && fs.statSync(out).size > 0) { p = out; ext = "azw3"; conv = "epub"; } else conv = "fail";
            } else conv = "fail";
        }
        const buf = fs.readFileSync(p);
        return { name: f, mtime: st.mtimeMs, srcSize: st.size, path: p, ext, conv, size: buf.length, sha: crypto.createHash("sha256").update(buf).digest("hex") };
    }
    // bk_<id>.meta / bk_<id>.p0 -> { body, type } | null
    serve(name) {
        const m = /^bk_(b[0-9a-f]{14})\.(meta|p0)$/.exec(name), k = m && this.known[m[1]];
        if (!k || !fs.existsSync(k.path)) return null;
        if (m[2] === "meta") return k.ext + " " + k.size + " " + k.sha + " 1\n";
        return fs.readFileSync(k.path).toString("base64").replace(/(.{76})/g, "$1\n") + "\n";
    }
}
module.exports = { Books, findCalibre };
