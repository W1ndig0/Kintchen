/* Kitchen Hub book cloud (run by brain.js).
 * Your books live in a secret gist "Kitchen Hub books": bk_<id>.meta and bk_<id>.p0, .p1 ... (base64, 76-character
 * lines, ~1.5 MB of book per part).
 *   meta: "ext size sha256 parts"            a plain book (10.3)
 *         "ext size sha256 parts a1 <iv>"    10.4: locked with your passphrase (AES-256-CTR, 16-byte iv in hex)
 *   size and sha256 are of the real book, so the Kindle checks it after unlocking.
 *   book key = SHA-256( K | "books" ), K = SHA-256 applied 1000x to "kitchenhub|" + passphrase (the list lock's key)
 * What each book is, and whether it should be on the Kindle, is a "book" line in your (locked) list:
 *   title|author|ext|size|want(kindle|cloud)|src|added|conv
 * The Kindle downloads the ones marked "kindle" into its library at the next sync (hub_books.sh) and removes
 * ones you moved back to the cloud. Here: Project Gutenberg requests, EPUB -> AZW3 conversion, locking, tidying.
 * 10.4: there is no DRM check anywhere; whatever you upload is stored as it is (locked).                         */
const crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const PART = 2000000;            // base64 characters per part

function bookKey(pass) {
    if (!pass) return null;
    let k = Buffer.from("kitchenhub|" + pass, "utf8");
    for (let i = 0; i < 1000; i++) k = crypto.createHash("sha256").update(k).digest();
    return crypto.createHash("sha256").update(Buffer.concat([k, Buffer.from("books", "utf8")])).digest();
}
function ctr(key, iv, buf) { const c = crypto.createCipheriv("aes-256-ctr", key, iv); return Buffer.concat([c.update(buf), c.final()]); }

module.exports = async function runBooks(ctx) {
    const { gh, items, edit, log, brain, NOW, TODAY, HubCal } = ctx;
    const fetchBin = ctx.fetchBin, KEY = bookKey(process.env.HUB_PASS || "");
    // the shelf gist (made once)
    let bg = brain.booksGist || "";
    if (!bg) {
        const g = await gh("POST", "/gists", { public: false, description: "Kitchen Hub books (your book cloud; written by the phone app and the GitHub Action)", files: { "README.md": { content: "Your Kitchen Hub book cloud. Each book is bk_<id>.meta + bk_<id>.p0, .p1 ... (base64, locked with your passphrase). Manage it from the phone app's BOOKS tab or the fridge's Books app.\n" } } });
        bg = brain.booksGist = g.id; log("made the books gist");
    }
    async function store(id, ext, buf) {
        const sha = crypto.createHash("sha256").update(buf).digest("hex");
        let body = buf, lock = "";
        if (KEY) { const iv = crypto.randomBytes(16); body = ctr(KEY, iv, buf); lock = " a1 " + iv.toString("hex"); }
        const b64 = body.toString("base64").replace(/(.{76})/g, "$1\n"), n = Math.max(1, Math.ceil(b64.length / PART));
        for (let i = 0; i < n; i++) await gh("PATCH", "/gists/" + bg, { files: { ["bk_" + id + ".p" + i]: { content: b64.slice(i * PART, (i + 1) * PART) } } });
        await gh("PATCH", "/gists/" + bg, { files: { ["bk_" + id + ".meta"]: { content: ext + " " + buf.length + " " + sha + " " + n + lock + "\n" } } });      // last: the Kindle only sees whole books
        return { size: buf.length, parts: n };
    }
    async function metaOf(id, gist) {
        const f = (gist.files || {})["bk_" + id + ".meta"];
        return f ? String((await ctx.fileText(f)) || "").trim().split(/\s+/) : null;
    }
    async function load(id, gist) {
        const files = gist.files || {}, m = await metaOf(id, gist);
        if (!m) return null;
        let b64 = "";
        for (let i = 0; i < +m[3]; i++) { const t = await ctx.fileText(files["bk_" + id + ".p" + i]); if (t === null) return null; b64 += t; }
        let buf = Buffer.from(b64.replace(/\s/g, ""), "base64");
        if (m[4] === "a1") { if (!KEY || !/^[0-9a-f]{32}$/.test(m[5] || "")) return null; buf = ctr(KEY, Buffer.from(m[5], "hex"), buf); }
        return crypto.createHash("sha256").update(buf).digest("hex") === m[2] ? { ext: m[0], buf, locked: m[4] === "a1", parts: +m[3] } : null;
    }
    const safe = (s) => String(s || "").replace(/[|\t\n\r]/g, " ").trim().slice(0, 120);
    let n = 0;

    // 1. Project Gutenberg: "book|gut|<number>" (from the phone, the fridge or the PC)
    for (const r of items("req")) {
        if (r.state !== "open" || r.text === null) continue;
        const f = r.text.split("|");
        if (f[0] !== "book" || f[1] !== "gut") continue;
        const num = String(f[2] || "").replace(/\D/g, "");
        if (!num) { edit(r.id, "req", "done", r.text + "|fail|no book number"); continue; }
        const meta = await ctx.get("https://gutendex.com/books/" + num, 20000);
        let j = null; try { j = meta ? JSON.parse(meta) : null; } catch (e) {}
        if (!j || !j.formats) { edit(r.id, "req", "done", r.text + "|fail|Project Gutenberg didn't answer (try again later)"); continue; }
        const fm = j.formats, url = fm["application/x-mobipocket-ebook"] || fm["application/epub+zip"];
        const ext = fm["application/x-mobipocket-ebook"] ? "mobi" : "epub";
        if (!url) { edit(r.id, "req", "done", r.text + "|fail|no Kindle or EPUB file for that book"); continue; }
        const buf = await fetchBin(url, 60000);
        if (!buf || buf.length < 1000) { edit(r.id, "req", "done", r.text + "|fail|the download didn't work"); continue; }
        const id = "g" + num, au = (j.authors && j.authors[0] && j.authors[0].name) || "";
        const st = await store(id, ext, buf);
        edit(id, "book", "open", HubCal.recText("book", { title: safe(j.title), author: safe(au.replace(/^([^,]+), (.+)$/, "$2 $1")), ext, size: st.size, want: "kindle", src: "gutenberg", added: TODAY, conv: "" }));
        edit(r.id, "req", "done", r.text + "|ok|" + safe(j.title));
        log("book from Project Gutenberg: " + st.size + " bytes"); n++;
    }

    // 1b. an article as a book: "book|url|<address>" -> readable text, as an AZW3 when calibre is there, else TXT
    for (const r of items("req")) {
        if (r.state !== "open" || r.text === null) continue;
        const f = r.text.split("|");
        if (f[0] !== "book" || f[1] !== "url") continue;
        const url = f.slice(2).join("|");
        if (!/^https?:\/\//.test(url)) { edit(r.id, "req", "done", r.text + "|fail|not a web address"); continue; }
        const html = await ctx.get(url, 25000);
        if (!html) { edit(r.id, "req", "done", r.text + "|fail|couldn't open the page"); continue; }
        const title = safe(ctx.txt((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "") || url.replace(/^https?:\/\//, "").slice(0, 60)).slice(0, 90);
        let body = (/<article[\s\S]*?<\/article>/i.exec(html) || /<main[\s\S]*?<\/main>/i.exec(html) || /<body[\s\S]*<\/body>/i.exec(html) || [html])[0];
        body = body.replace(/<(script|style|noscript|nav|footer|header|aside|form|iframe|svg)[\s\S]*?<\/\1>/gi, "");
        const text = ctx.decodeEnts(body.replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
        if (text.length < 200) { edit(r.id, "req", "done", r.text + "|fail|no readable text on that page"); continue; }
        const id = ctx.newId().replace(/[^A-Za-z0-9]/g, "");      // 10.4: was "HubCal && ctx.newId()..." (a leftover)
        let ext = "txt", buf = Buffer.from(title + "\n" + url + "\n\n" + text + "\n", "utf8");
        const tool = process.env.BOOK_CONVERT || (() => { try { cp.execSync("command -v ebook-convert", { stdio: "ignore" }); return "ebook-convert"; } catch (e) { return ""; } })();
        if (tool) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kha")), inF = path.join(dir, "article.html"), outF = path.join(dir, "out.azw3");
            fs.writeFileSync(inF, "<html><head><meta charset='utf-8'><title>" + title.replace(/</g, "&lt;") + "</title></head><body><h1>" + title.replace(/</g, "&lt;") + "</h1>" + text.split("\n\n").map(p => "<p>" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</p>").join("") + "</body></html>");
            try { cp.execFileSync(tool, [inF, outF], { stdio: "ignore", timeout: 240000 }); } catch (e) {}
            if (fs.existsSync(outF) && fs.statSync(outF).size > 300) { buf = fs.readFileSync(outF); ext = "azw3"; }
            fs.rmSync(dir, { recursive: true, force: true });
        }
        const st = await store(id, ext, buf);
        edit(id, "book", "open", HubCal.recText("book", { title, author: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], ext, size: st.size, want: "kindle", src: "article", added: TODAY, conv: "" }));
        edit(r.id, "req", "done", r.text.slice(0, 300) + "|ok|" + title);
        log("article saved as a book (" + ext + ")"); n++;
    }

    // 2. EPUB -> AZW3 for the Kindle's own reader (KOReader reads EPUB as it is; this is for everything else)
    const epubs = items("book").filter(b => b.state === "open" && b.text && (() => { const o = HubCal.parseRec("book", b.text); return o.ext === "epub" && o.want === "kindle" && !o.conv; })());
    if (epubs.length && (process.env.BOOK_CONVERT || process.env.GITHUB_ACTIONS)) {
        let tool = process.env.BOOK_CONVERT || "ebook-convert";
        if (!process.env.BOOK_CONVERT) {
            try { cp.execSync("command -v ebook-convert", { stdio: "ignore" }); }
            catch (e) { try { log("installing calibre for EPUB conversion"); cp.execSync("sudo apt-get update -qq && sudo apt-get install -y -qq calibre >/dev/null", { stdio: "ignore", timeout: 400000 }); } catch (e2) { tool = ""; } }
        }
        const gist = await gh("GET", "/gists/" + bg);
        for (const b of epubs.slice(0, 2)) {
            const o = HubCal.parseRec("book", b.text), src = await load(b.id, gist);
            if (!src || !tool) { if (!tool) { o.conv = "fail"; edit(b.id, "book", "open", HubCal.recText("book", o)); } continue; }
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khb")), inF = path.join(dir, "in.epub"), outF = path.join(dir, "out.azw3");
            fs.writeFileSync(inF, src.buf);
            try { cp.execFileSync(tool, [inF, outF], { stdio: "ignore", timeout: 300000 }); } catch (e) {}
            if (fs.existsSync(outF) && fs.statSync(outF).size > 500) {
                const st = await store(b.id, "azw3", fs.readFileSync(outF));
                const drop = {}; for (let i = st.parts; i < src.parts; i++) drop["bk_" + b.id + ".p" + i] = null;
                if (Object.keys(drop).length) await gh("PATCH", "/gists/" + bg, { files: drop });
                o.ext = "azw3"; o.size = st.size; o.conv = "epub";
                log("converted an EPUB for the Kindle"); n++;
            } else o.conv = "fail";
            edit(b.id, "book", "open", HubCal.recText("book", o));
            fs.rmSync(dir, { recursive: true, force: true });       // 10.4: the temp folder was left behind when the book couldn't be read
        }
    }

    // 2b. 10.4: lock books that were stored before 10.4 (two per run; same size, so the parts stay the same)
    if (KEY) {
        const gist = await gh("GET", "/gists/" + bg);
        let done = 0;
        for (const b of items("book")) {
            if (done >= 2 || b.state !== "open") continue;
            const m = await metaOf(b.id, gist);
            if (!m || m[4] === "a1") continue;
            const src = await load(b.id, gist);
            if (!src) continue;
            await store(b.id, src.ext, src.buf);
            done++; n++;
        }
        if (done) log("locked " + done + " older book(s) with your passphrase");
    } else if (items("book").length) log("no HUB_PASS secret: books are stored unlocked");

    // 3. once a day (and when a book was deleted): remove files of books that are gone from the shelf
    const open = {}, gone = {}; let dels = 0;
    for (const b of ctx.allItems("book")) { if (b.state === "del") { dels++; gone[b.id] = 1; } else open[b.id] = 1; }
    if (brain.booksGC !== TODAY || brain.booksDels !== dels) {
        brain.booksGC = TODAY; brain.booksDels = dels;
        const gist = await gh("GET", "/gists/" + bg), drop = {};
        for (const name of Object.keys(gist.files || {})) {
            const m = /^bk_([A-Za-z0-9]+)\.(meta|p\d+)$/.exec(name);
            // deleted on purpose, or left behind by an upload that never finished (nothing has touched the gist for 6 h)
            if (m && !open[m[1]] && (gone[m[1]] || (gist.updated_at && NOW - Date.parse(gist.updated_at) > 6 * 3600000))) drop[name] = null;
        }
        if (Object.keys(drop).length) { await gh("PATCH", "/gists/" + bg, { files: drop }); log("removed " + Object.keys(drop).length + " files of deleted books"); }
    }
    return { gist: bg, n };
};
module.exports.bookKey = bookKey;
