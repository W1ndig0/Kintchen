/* Kitchen Hub v11 - the hub's web server (Node built-ins only).
 *
 *   /                 the web app (phone layout, desktop mode on wide screens)          no key (no data in it)
 *   /api/hello        "is this a Kitchen Hub?"                                          no key
 *   /api/pair         a device trades a pairing code for its key                       no key (code-limited)
 *   /api/*            everything else                                                   PC itself or a signed request
 *   /kindle/*         the real fridge page, read-only, with the PC's data files         view cookie (desktop mode)
 *
 * Only addresses on the home network, Tailscale (100.64.0.0/10) and the PC itself are answered at all. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { atomicWrite } = require("./store.js");
const { isLocal } = require("./auth.js");

const VERSION = "11.0-dev";
const MAX_BODY = 2 * 1024 * 1024;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
                ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
// fridge actions -> the "cmd" item text the fridge page already understands (runCommands in the page)
const QUEUE_ACTIONS = /^(sync|update-check|update-install|update-rollback|log|reload|timer:\d{1,3}|note:[^\t\n]{1,280}|screen:(front|tiles)|contrast:(normal|strong|max)|open:(recipes|list|calendar|board))$/;
function cmdFor(a) {
    if (a === "sync" || a === "log" || a === "reload") return { kind: "cmd", text: a };
    if (/^update-/.test(a)) return { kind: "cmd", text: "update|" + a.slice(7) };
    if (/^note:/.test(a)) return { kind: "msg", text: a.slice(5).replace(/\|/g, "/") };
    const i = a.indexOf(":"); return { kind: "cmd", text: a.slice(0, i) + "|" + a.slice(i + 1) };
}

function homeAddr(a) {
    a = String(a || "").replace(/^::ffff:/, "");
    if (a === "::1" || a === "127.0.0.1") return true;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
    if (m) {
        const p = m.slice(1).map(Number);
        return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
               (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254);
    }
    return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);       // IPv6 private / link-local (Tailscale uses fd7a:)
}
// the address other devices should use: config publicUrl (e.g. the Tailscale https name), else Tailscale IP, else home IP
function shareUrl(publicUrl, port, homeOnly) {
    if (publicUrl && !homeOnly) return String(publicUrl).replace(/\/+$/, "");
    const ips = [];
    Object.values(require("os").networkInterfaces()).forEach(l => (l || []).forEach(i => { if (i.family === "IPv4" && !i.internal) ips.push(i.address); }));
    const ts = ips.find(a => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)), home = ips.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a));
    const ip = (homeOnly ? home || ts : ts || home) || "127.0.0.1";
    return "http://" + ip + ":" + port;
}
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } }
function jsStr(s) { return JSON.stringify(String(s)).replace(/[\u2028\u2029]/g, c => c === "\u2028" ? "\\u2028" : "\\u2029"); }

function createServer(opts) {
    const { store, auth, dataDir, webDir, kindleDir, log = () => {} } = opts;
    const now = opts.now || Date.now;
    const views = new Map();        // view cookie -> expiry

    function send(res, code, body, type, extra) {
        const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
        res.writeHead(code, Object.assign({ "Content-Type": type || "application/json", "Content-Length": b.length, "Cache-Control": "no-store",
                                            "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }, extra || {}));
        res.end(b);
    }
    const err = (res, code, m) => send(res, code, { error: m });

    function serveFile(res, root, rel, extra) {
        const f = path.normalize(path.join(root, rel));
        if (!f.startsWith(path.normalize(root + path.sep)) && f !== path.normalize(root)) return err(res, 404, "not found");
        fs.stat(f, (e, st) => {
            if (e || !st.isFile()) return err(res, 404, "not found");
            fs.readFile(f, (e2, b) => e2 ? err(res, 500, "read failed") : send(res, 200, b, TYPES[path.extname(f).toLowerCase()] || "application/octet-stream",
                                                                          Object.assign({ "Cache-Control": "no-cache" }, extra || {})));
        });
    }
    function viewOk(req) {
        if (isLocal(req.socket.remoteAddress)) return true;
        const m = /(?:^|;\s*)kh_view=([0-9a-f]{48})/.exec(req.headers.cookie || "");
        const t = m && views.get(m[1]);
        return !!(t && t > now());
    }
    function kindleItemsJs() {
        const lines = store.text.split("\n").filter(l => l && l[0] !== "#");
        return "window.HUB_ITEMS = { st: \"ok\", pending: 0, at: " + Math.floor(now() / 1000) + ", lines: [" +
               lines.map(jsStr).join(",\n") + (lines.length ? "," : "") + "\"\"] };\n";
    }

    async function api(req, res, url, body, who) {
        const p = url.pathname, m = req.method;
        if (p === "/api/status" && m === "GET") {
            const kin = auth.list().filter(d => d.kind === "kindle").sort((a, b) => b.seen - a.seen)[0];
            return send(res, 200, { app: "kitchen-hub", version: VERSION, time: now(), items: store.items().length,
                                    devices: auth.list().length, share: shareUrl(opts.publicUrl, opts.port || 8770), kindleSeen: kin ? kin.seen : 0, queue: store.items().filter(it => it.kind === "cmd" && it.state === "open").length, you: who });
        }
        if (p === "/api/store") {
            if (m === "GET") {
                const tag = store.etag();
                if (req.headers["if-none-match"] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
                return send(res, 200, store.text, "text/plain; charset=utf-8", { ETag: tag });
            }
            if (m === "POST") {
                const changed = store.merge(body.toString("utf8"), now());
                if (changed) log("store: merged from " + who);
                return send(res, 200, store.text, "text/plain; charset=utf-8", { ETag: store.etag(), "X-KH-Changed": changed ? "1" : "0" });
            }
        }
        if (p === "/api/pair/code" && m === "POST") return send(res, 200, auth.newCode());
        if (p === "/api/pair/kindle" && m === "POST") {
            const c = auth.newCode().code, r = auth.pair(c, "Fridge", "kindle");
            const u = shareUrl(null, opts.port || 8770, true);
            log("fridge pairing made by " + who);
            return send(res, 200, { id: r.id, conf: "# v11: the hub on the PC (remove these 3 lines to go back to GitHub)\nPC_URL=" + u + "\nPC_ID=" + r.id + "\nPC_KEY=" + r.secret + "\n" });
        }
        if (p === "/api/devices" && m === "GET") return send(res, 200, auth.list());
        let dm = /^\/api\/devices\/(d[0-9a-f]{12})(\/name)?$/.exec(p);
        if (dm && m === "DELETE" && !dm[2]) return auth.revoke(dm[1]) ? (log("device revoked " + dm[1]), send(res, 200, { ok: 1 })) : err(res, 404, "no such device");
        if (dm && m === "POST" && dm[2]) { let j = {}; try { j = JSON.parse(body); } catch (e) {} return auth.rename(dm[1], j.name) ? send(res, 200, { ok: 1 }) : err(res, 404, "no such device"); }
        if (p === "/api/queue" && m === "GET") {
            const HubData = require("../../../cloud/hubdata.js");
            const q = HubData.items(store.text).filter(it => it.kind === "cmd" || (it.kind === "msg" && it.id[0] === "q"))
                .map(it => { const f = it.text.split("|"), res = it.state === "done" ? f[f.length - 1] : "";
                             return { id: it.id, action: it.kind === "msg" ? "note: " + it.text : (it.state === "done" ? f.slice(0, -1) : f).join(" "),
                                      state: it.kind === "msg" ? (it.state === "done" ? "read" : "on the fridge") : it.state === "open" ? "queued" : "done" + (res && res !== "ok" ? " (" + res + ")" : ""),
                                      at: it.ts }; })
                .sort((a, b) => a.at - b.at).slice(-60);
            return send(res, 200, q);
        }
        if (p === "/api/queue" && m === "POST") {
            let j = {}; try { j = JSON.parse(body); } catch (e) {}
            const a = String(j.action || "");
            if (!QUEUE_ACTIONS.test(a)) return err(res, 400, "unknown action");
            const HubData = require("../../../cloud/hubdata.js"), c = cmdFor(a), id = HubData.newId("q");
            store.merge(HubData.makeLine(now(), id, c.kind, "open", c.text), now()); log("queued " + a + " by " + who);
            return send(res, 200, { id, action: a, state: "queued" });
        }
        let qm = /^\/api\/queue\/([A-Za-z0-9._-]{1,64})$/.exec(p);
        if (qm && m === "DELETE") {
            const HubData = require("../../../cloud/hubdata.js");
            const it = HubData.items(store.text).find(x => x.id === qm[1] && (x.kind === "cmd" || x.kind === "msg"));
            if (!it) return err(res, 404, "no such action");
            if (it.kind === "cmd" && it.state !== "open") return err(res, 409, "the fridge already did it");
            store.merge(HubData.edit(store.text, it.id, it.kind, "del", it.text, now()), now());
            return send(res, 200, { ok: 1 });
        }
        // ---- the fridge (a paired device of kind "kindle") ----
        if (p.startsWith("/api/kindle/")) {
            const dev = auth.devices[who];
            if (!dev || dev.kind !== "kindle") return err(res, 403, "fridge only");
            // the address the fridge itself used to reach the PC (it obviously works from there)
            const share = /^[\w.:\[\]-]{1,100}$/.test(req.headers.host || "") ? "http://" + req.headers.host : shareUrl(opts.publicUrl, opts.port || 8770, true);
            if (p === "/api/kindle/links" && m === "GET") {
                let at = 0; try { at = Math.floor((JSON.parse(fs.readFileSync(path.join(dataDir, "gist", "main", "brain.json"), "utf8")).lastRun || 0) / 1000); } catch (e) {}
                const pk = opts.pkgToken ? share + "/pkg/" + opts.pkgToken : "";
                return send(res, 200, (pk ? "BUNDLE_URL=" + pk + "/bundle.txt\nEXTRA_URL=" + pk + "/extra.js\n" : "") +
                                      (opts.books && opts.pkgToken ? "BOOKS_URL=" + share + "/books/" + opts.pkgToken + "/\n" : "") +
                                      (opts.calToken ? "ICS_URL=" + share + "/cal/" + opts.calToken + "/calendar.ics\n" : "") + (at ? "BRAIN_AT=" + at + "\n" : ""), "text/plain; charset=utf-8");
            }
            if (p === "/api/kindle/status" && m === "POST") {
                let j; try { j = JSON.parse(body.toString("utf8")); } catch (e) { return err(res, 400, "not JSON"); }
                if (!j || typeof j !== "object" || Array.isArray(j)) return err(res, 400, "not a status");
                fs.mkdirSync(path.join(dataDir, "gist", "main"), { recursive: true });
                atomicWrite(path.join(dataDir, "gist", "main", "kindle.json"), JSON.stringify(j));
                return send(res, 200, { ok: 1 });
            }
            if (p === "/api/kindle/log" && m === "POST") {
                const d = path.join(dataDir, "logs"); fs.mkdirSync(d, { recursive: true });
                atomicWrite(path.join(d, "kindle-log.txt"), body.toString("utf8").slice(0, 500000));
                log("fridge log received (" + body.length + " bytes)");
                return send(res, 200, { ok: 1 });
            }
            if (p === "/api/kindle/update" && m === "GET" && opts.shiftcalDir && opts.pkgToken) {
                const t = require("./updates.js").manifest(opts.shiftcalDir);
                const sig = crypto.createHmac("sha256", Buffer.from(dev.secret, "hex")).update(t).digest("hex");
                return send(res, 200, t, "text/plain; charset=utf-8", { "X-KH-Body": sig, "X-KH-Files": share + "/upd/" + opts.pkgToken + "/kindle" });
            }
            if (p === "/api/kindle/rsearch" && m === "GET") {
                const d = path.join(dataDir, "pkgcache"); fs.mkdirSync(d, { recursive: true });
                const t = await (opts.rsearch || require("../../../cloud/package.js").search)(d, url.searchParams.get("q") || "");
                return send(res, 200, t, TYPES[".js"]);
            }
        }
        if (p === "/api/jobs" && m === "GET" && opts.jobs) {
            const j = opts.jobs;
            return send(res, 200, { running: !!j.running, last: j.last ? Object.assign({}, j.last, { out: undefined }) : null, alerts: j.alerts().slice(-30).reverse(),
                                    calendar: opts.calToken ? "/cal/" + opts.calToken + "/calendar.ics" : "" });
        }
        if (p === "/api/jobs/run" && m === "POST" && opts.jobs) { opts.jobs.run("asked by " + who); return send(res, 200, { ok: 1 }); }
        if (p === "/api/jobs/log" && m === "GET" && opts.jobs) return send(res, 200, (opts.jobs.last && opts.jobs.last.out) || "", "text/plain; charset=utf-8");
        if (p.startsWith("/api/push") && opts.pusher) {
            const P = opts.pusher; let j = {}; try { j = JSON.parse(body || "{}"); } catch (e) {}
            if (p === "/api/push/key" && m === "GET") return send(res, 200, { key: P.keys.pub, subscribed: !!P.subs[who], settings: P.subs[who] ? P.subs[who].settings : null });
            if (p === "/api/push/subscribe" && m === "POST") return P.subscribe(who, j) ? send(res, 200, { ok: 1 }) : err(res, 400, "bad subscription");
            if (p === "/api/push/unsubscribe" && m === "POST") { P.unsubscribe(who); return send(res, 200, { ok: 1 }); }
            if (p === "/api/push/settings" && m === "POST") { const st = P.settings(who, j); return st ? send(res, 200, st) : err(res, 404, "alerts aren't on for this device"); }
            if (p === "/api/push/test" && m === "POST") { const n = await P.send({ title: "Kitchen Hub", body: "Test alert from your PC", prio: 5 }); return send(res, 200, { sent: n }); }
        }
        if (p === "/api/kit" && m === "GET" && opts.shiftcalDir) {
            let offered = "", fridge = null;
            try { offered = (/^VERSION="([^"]*)"/m.exec(fs.readFileSync(path.join(opts.shiftcalDir, "power_loop.sh"), "utf8")) || [])[1] || ""; } catch (e) {}
            try { fridge = JSON.parse(fs.readFileSync(path.join(dataDir, "gist", "main", "kindle.json"), "utf8")); } catch (e) {}
            return send(res, 200, { offered, fridge: fridge ? { v: fridge.v, pct: fridge.pct, ts: fridge.ts } : null, git: fs.existsSync(path.join(opts.shiftcalDir, "..", "..", ".git")),
                                    kit: process.env.KH_KIT || "" });
        }
        if (p === "/api/kit/install" && m === "POST") {
            if (who !== "owner") return err(res, 403, "only on the PC itself");
            const r = require("./kits.js").install(dataDir, body, now());
            if (r.error) { log("kit install refused: " + r.error); return err(res, 400, r.error); }
            let c = {}; try { c = JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")); } catch (e) {}
            c.kitDir = r.dir; atomicWrite(path.join(dataDir, "config.json"), JSON.stringify(c, null, 1));
            log("kit " + r.version + " installed (" + r.dir + ") - restarting");
            send(res, 200, r);
            if (opts.onRestart) setTimeout(opts.onRestart, 800);
            return;
        }
        if (p === "/api/kit/pull" && m === "POST" && opts.shiftcalDir) {
            if (who !== "owner") return err(res, 403, "only on the PC itself");
            const r = require("child_process").spawnSync("git", ["pull", "--ff-only"], { cwd: path.join(opts.shiftcalDir, "..", ".."), encoding: "utf8", timeout: 120000, windowsHide: true });
            log("kit: git pull -> " + r.status);
            return send(res, r.status === 0 ? 200 : 500, { ok: r.status === 0, out: String((r.stdout || "") + (r.stderr || "")).slice(-1500) });
        }
        if (p === "/api/books" && m === "GET" && opts.books) {
            return send(res, 200, { folder: opts.books.dir, calibre: opts.books.convert === null ? null : !!opts.books.convert,
                                    books: Object.keys(opts.books.known).map(id => { const k = opts.books.known[id]; return { id, name: k.name, ext: k.ext, size: k.size, conv: k.conv }; }) });
        }
        if (p === "/api/books/scan" && m === "POST" && opts.books) return send(res, 200, { changes: opts.books.scan(now()) });
        if (p.startsWith("/api/prices") && opts.prices) {
            const P = opts.prices; let j = {}; if (m === "POST" && !/\.csv$/.test(p)) { try { j = JSON.parse(body || "{}"); } catch (e) {} }
            if (p === "/api/prices/check" && m === "POST") {
                const HubData = require("../../../cloud/hubdata.js");
                const list = HubData.items(store.text, "shop").filter(i => i.state === "open" && i.text[0] !== "~")
                    .map(i => { const s = HubData.HubCal.parseShop(i.text); return { name: s.name, qty: s.qty }; }).filter(i => i.name);
                if (!list.length) return err(res, 400, "the shopping list is empty");
                const r = await P.check(list, now());
                if (opts.pusher && j.alert !== false) opts.pusher.send({ title: "Price check", body: r.summary, prio: 3 }).catch(() => {});
                return send(res, 200, r);
            }
            if (p === "/api/prices/last" && m === "GET") return send(res, 200, P.last() || {});
            if (p === "/api/prices/book" && m === "GET") return send(res, 200, { book: P.db.book, stores: require("./prices.js").STORES.map(s => ({ id: s.id, name: s.name })) });
            if (p === "/api/prices/book" && m === "POST") { const x = P.addBook(j, now()); return x ? send(res, 200, x) : err(res, 400, "need a store, an item and a price"); }
            const pb = /^\/api\/prices\/book\/(p[0-9a-f]{10})$/.exec(p);
            if (pb && m === "DELETE") return P.delBook(pb[1]) ? send(res, 200, { ok: 1 }) : err(res, 404, "no such price");
            if (p === "/api/prices/book.csv" && m === "GET") return send(res, 200, P.exportCsv(), "text/csv; charset=utf-8", { "Content-Disposition": "attachment; filename=price-book.csv" });
            if (p === "/api/prices/book.csv" && m === "POST") return send(res, 200, { added: P.importCsv(body.toString("utf8"), now()) });
            if (p === "/api/prices/pick" && m === "POST") {
                if (!j.item || !require("./prices.js").STORES.some(s => s.id === j.store)) return err(res, 400, "bad pick");
                P.pick(j.item, j.store, j.reset ? null : j.none ? { none: 1 } : { name: String(j.name || "").slice(0, 160), price: Number(j.price) || 0 });
                return send(res, 200, { ok: 1 });
            }
        }
        if (p === "/api/view" && m === "POST") {       // a cookie so the virtual Kindle frame can load its data files
            const v = crypto.randomBytes(24).toString("hex"), until = now() + 12 * 3600000;
            for (const [k, t] of views) if (t < now()) views.delete(k);
            views.set(v, until);
            return send(res, 200, { ok: 1 }, null, { "Set-Cookie": "kh_view=" + v + "; Path=/kindle/; HttpOnly; SameSite=Strict; Max-Age=43200" });
        }
        return err(res, 404, "not found");
    }

    const server = http.createServer((req, res) => {
        const addr = req.socket.remoteAddress;
        if (!homeAddr(addr)) { req.destroy(); return; }
        let url; try { url = new URL(req.url, "http://hub"); } catch (e) { return err(res, 400, "bad address"); }
        const chunks = []; let size = 0;
        const limit = url.pathname === "/api/kit/install" ? 60 * 1024 * 1024 : MAX_BODY;      // a whole kit as a zip
        req.on("data", c => { size += c.length; if (size > limit) { err(res, 413, "too big"); req.destroy(); } else chunks.push(c); });
        req.on("end", async () => {
            if (res.writableEnded) return;
            const body = Buffer.concat(chunks), p = url.pathname;
            try {
                if (p === "/api/hello") return send(res, 200, { app: "kitchen-hub", version: VERSION });
                if (p === "/api/pair" && req.method === "POST") {
                    if (auth.locked(addr)) return err(res, 429, "too many tries - wait 15 minutes");
                    let j = {}; try { j = JSON.parse(body); } catch (e) {}
                    const r = auth.pair(j.code, j.name, j.kind);
                    if (r.error) { auth.failed(addr); return err(res, 403, r.error); }
                    log("paired " + j.kind + " '" + j.name + "' from " + addr);
                    return send(res, 200, r);
                }
                if (p.startsWith("/api/")) {
                    const a = auth.check(req, body, opts.ownerLocal);
                    if (a.error) return err(res, a.code || 401, a.error);
                    return await api(req, res, url, body, a.who);
                }
                // calendar subscription (iPhone/Outlook can't sign requests): a long random link, made once
                const cm = /^\/cal\/([0-9a-f]{32})\/(calendar(-p2)?\.ics)$/.exec(p);
                if (cm) {
                    if (!opts.calToken || cm[1] !== opts.calToken) return err(res, 404, "not found");
                    return serveFile(res, path.join(dataDir, "gist", "cloud"), cm[2], { "Content-Type": "text/calendar; charset=utf-8" });
                }
                // the fridge's package (fetched by sync_data.sh with plain curl, so a long random link, home network only)
                const pm = /^\/pkg\/([0-9a-f]{32})\/(bundle\.txt|extra\.js)$/.exec(p);
                if (pm) {
                    if (!opts.pkgToken || pm[1] !== opts.pkgToken) return err(res, 404, "not found");
                    const f = path.join(dataDir, "gist", "cloud", pm[2]);
                    if (!fs.existsSync(f)) return err(res, 404, "no package yet");
                    const b = fs.readFileSync(f), r = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "");
                    if (r) { const a = +r[1], e = Math.min(+r[2], b.length - 1); return send(res, 206, b.subarray(a, e + 1), "text/plain; charset=utf-8", { "Content-Range": "bytes " + a + "-" + e + "/" + b.length }); }
                    return send(res, 200, b, "text/plain; charset=utf-8");
                }
                // the book folder, in the book-gist layout the fridge's downloader already reads
                const bm = /^\/books\/([0-9a-f]{32})\/(bk_[0-9a-z]+\.(meta|p0))$/.exec(p);
                if (bm) {
                    if (!opts.books || !opts.pkgToken || bm[1] !== opts.pkgToken) return err(res, 404, "not found");
                    const b = opts.books.serve(bm[2]);
                    return b === null ? err(res, 404, "not found") : send(res, 200, b, "text/plain; charset=utf-8");
                }
                // fridge update files (the code itself; the signed list above says which and their checksums)
                const um = /^\/upd\/([0-9a-f]{32})\/kindle\/shiftcal\/(.+)$/.exec(p);
                if (um) {
                    if (!opts.pkgToken || um[1] !== opts.pkgToken || !opts.shiftcalDir) return err(res, 404, "not found");
                    const rel = decodeURIComponent(um[2]);
                    if (/(^|\/)\./.test(rel)) return err(res, 404, "not found");
                    return serveFile(res, opts.shiftcalDir, rel);
                }
                if (p.startsWith("/kindle/")) {
                    if (!viewOk(req)) return err(res, 403, "open the virtual Kindle from desktop mode");
                    const rel = decodeURIComponent(p.slice(8)) || "index.html";
                    if (rel === "hub_items.js") return send(res, 200, kindleItemsJs(), TYPES[".js"]);
                    const fromData = path.join(dataDir, "kindle", rel);
                    if (/^[\w.-]+\.js$/.test(rel) && fs.existsSync(fromData)) return serveFile(res, path.join(dataDir, "kindle"), rel);
                    // a data file the PC hasn't made yet: an empty script, like a fridge that hasn't synced (no console errors)
                    if (/^[\w.-]+\.js$/.test(rel) && !fs.existsSync(path.join(kindleDir, rel))) return send(res, 200, "/* not made yet */\n", TYPES[".js"]);
                    return serveFile(res, kindleDir, rel);
                }
                const rel = decodeURIComponent(p) === "/" ? "index.html" : decodeURIComponent(p).slice(1);
                if (opts.shared && opts.shared[rel]) return serveFile(res, path.dirname(opts.shared[rel]), path.basename(opts.shared[rel]));
                return serveFile(res, webDir, rel, rel === "index.html" ? { "Content-Security-Policy": "default-src 'self'; frame-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" } : null);
            } catch (e) {
                log("error " + (e && e.stack || e));
                if (!res.headersSent) err(res, 500, "hub error");
            }
        });
    });
    server.homeAddr = homeAddr;
    return server;
}
module.exports = { createServer, homeAddr, VERSION, QUEUE_ACTIONS };
