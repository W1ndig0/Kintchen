/* Kitchen Hub v11 - runs the existing jobs (cloud/brain.js) on the PC instead of GitHub Actions.
 *
 * brain.js talks to "GitHub gists" and "ntfy". Here both are a tiny server on 127.0.0.1 (never the network) that
 * stores everything on the PC:
 *   gist "main"   = the PC's list (hub.tsv in the Store) + data/gist/main/* (brain.json, kindle.json ...)
 *   gist "cloud"  = data/gist/cloud/* (calendar.ics, bundle.txt, extras ...)
 *   POST /ntfy/hub = an alert: kept in data/alerts.json and handed to onAlert (web push, later part)
 * HUB_PASS is empty, so brain.js writes plain text (v11 has no passphrase).
 * This is the same arrangement the brain's own tests use (tests/cloud/brain.test.js), so the jobs are unchanged. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), cp = require("child_process");
const { atomicWrite } = require("./store.js");

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const BRAIN = path.join(__dirname, "..", "..", "..", "cloud", "brain.js");


class BrainHost {
    constructor(opts) {
        this.store = opts.store; this.dir = opts.dataDir; this.log = opts.log || (() => {});
        this.onAlert = opts.onAlert || (() => {}); this.env = opts.env || {};
        this.gdir = path.join(this.dir, "gist");
        ["main", "cloud"].forEach(g => fs.mkdirSync(path.join(this.gdir, g), { recursive: true }));
        this.alertsFile = path.join(this.dir, "alerts.json");
        this.running = null; this.last = null; this.server = null; this.port = 0;
    }
    readFiles(g) {
        const d = path.join(this.gdir, g), files = {};
        if (!fs.existsSync(d)) return null;
        fs.readdirSync(d).filter(f => SAFE.test(f)).forEach(f => { files[f] = { filename: f, content: fs.readFileSync(path.join(d, f), "utf8"), truncated: false }; });
        if (g === "main") files["hub.tsv"] = { filename: "hub.tsv", content: this.store.text, truncated: false };
        return files;
    }
    writeFiles(g, files) {
        const d = path.join(this.gdir, g);
        Object.keys(files || {}).forEach(k => {
            if (!SAFE.test(k)) return;
            if (g === "main" && k === "hub.tsv") { if (files[k] && typeof files[k].content === "string") this.store.merge(files[k].content); return; }
            const f = path.join(d, k);
            if (files[k] === null) { try { fs.unlinkSync(f); } catch (e) {} }
            else if (typeof files[k].content === "string") atomicWrite(f, files[k].content);
        });
    }
    alerts() { try { return JSON.parse(fs.readFileSync(this.alertsFile, "utf8")); } catch (e) { return []; } }
    addAlert(a) { const l = this.alerts(); l.push(a); atomicWrite(this.alertsFile, JSON.stringify(l.slice(-200))); this.onAlert(a); }

    start() {
        this.server = http.createServer((req, res) => {
            let body = ""; req.on("data", d => { body += d; if (body.length > 20e6) req.destroy(); });
            req.on("end", () => {
                const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
                const p = req.url.split("?")[0];
                if (req.method === "POST" && p === "/ntfy/hub") {
                    this.addAlert({ at: Date.now(), title: String(req.headers.title || "Kitchen Hub"), body: body.slice(0, 2000), tags: String(req.headers.tags || ""), prio: +req.headers.priority || 3 });
                    return json(200, { ok: 1 });
                }
                const m = /^\/gists\/?([a-z]*)$/.exec(p);
                if (!m) return json(404, {});
                try {
                    if (req.method === "POST" && !m[1]) { this.writeFiles("cloud", JSON.parse(body).files); return json(200, { id: "cloud", files: this.readFiles("cloud") }); }
                    if (m[1] !== "main" && m[1] !== "cloud") return json(404, {});
                    if (req.method === "PATCH") this.writeFiles(m[1], JSON.parse(body).files);
                    return json(200, { id: m[1], files: this.readFiles(m[1]) });
                } catch (e) { this.log("jobs gist error " + e.message); return json(500, {}); }
            });
        });
        return new Promise(r => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; r(); }));
    }
    stop() { if (this.server) this.server.close(); }

    // one run of the jobs; resolves { code, secs, out }
    run(why) {
        if (this.running) return this.running;
        const base = "http://127.0.0.1:" + this.port, t0 = Date.now();
        const env = Object.assign({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || "", TEMP: process.env.TEMP || "", TMP: process.env.TMP || "",
                                    GIST_ID: "main", GIST_TOKEN: "local", GH_API: base, CLOUD_GIST_ID: "cloud", HUB_PASS: "",
                                    NTFY_TOPIC: "hub", NTFY_URL: base + "/ntfy", POSTAL: this.env.POSTAL || "V2L" },
                                  { PACKAGE_NODE: "1", NO_BOOK_CLOUD: "1" }, this.env);
        this.running = new Promise(resolve => {
            const p = cp.spawn(process.execPath, [BRAIN], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
            const kill = setTimeout(() => p.kill(), 8 * 60000);
            p.on("exit", code => {
                clearTimeout(kill);
                this.last = { at: t0, why, code, secs: Math.round((Date.now() - t0) / 1000), out: out.slice(-4000), bundle: env.SKIP_BUNDLE !== "1" };
                this.log("jobs (" + why + "): " + (code === 0 ? "ok" : "FAILED code " + code) + " in " + this.last.secs + " s");
                if (code !== 0) this.log(out.slice(-800));
                this.running = null; resolve(this.last);
            });
        });
        return this.running;
    }
    // every 30 minutes at :07 and :37, like the cloud schedule
    schedule() {
        const tick = () => {
            const d = new Date(), m = d.getMinutes(), next = (m < 7 ? 7 : m < 37 ? 37 : 67) - m;
            this.timer = setTimeout(() => { this.run("schedule").finally(tick); }, (next * 60 - d.getSeconds()) * 1000);
        };
        tick();
    }
}
module.exports = { BrainHost };
