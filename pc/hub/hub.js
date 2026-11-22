#!/usr/bin/env node
/* Kitchen Hub v11 - the hub on the PC. Start: node pc/hub/hub.js   (install.ps1 makes Windows start it at boot)
 *
 * Data folder: %LOCALAPPDATA%\KitchenHub on Windows, ~/.kitchenhub elsewhere, or KH_DATA.
 *   hub.tsv (+ .bak)   the list, plain text        devices.json   paired devices
 *   queue.json         actions for the fridge       config.json    { "port": 8770, "publicUrl": "https://<pc>.<tailnet>.ts.net" }
 *   hub.log            what happened (rotated at 1 MB)
 * Book folder: Documents\Kitchen Hub Books (config "booksDir"): every book in it goes to the fridge's library.
 *   import.tsv         drop the old gist's hub.tsv here once (+ import.pass = your passphrase): merged in at start,
 *                      unlocked to plain text, renamed to import.done.tsv; import.pass is deleted
 * Options: --port N   --data DIR */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { Store } = require("./lib/store.js");
const { Auth } = require("./lib/auth.js");
const { createServer, VERSION } = require("./lib/server.js");

const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : undefined; };
const DATA = arg("data") || process.env.KH_DATA ||
             (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || os.homedir(), "KitchenHub") : path.join(os.homedir(), ".kitchenhub"));
fs.mkdirSync(DATA, { recursive: true });
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8")); } catch (e) {}
const PORT = Number(arg("port") || cfg.port || 8770);

const LOG = path.join(DATA, "hub.log");
function log(m) {
    const line = new Date().toISOString().replace("T", " ").slice(0, 19) + " " + m + "\n";
    try {
        if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1e6) fs.renameSync(LOG, LOG + ".1");
        fs.appendFileSync(LOG, line);
    } catch (e) {}
    if (process.stdout.isTTY) process.stdout.write(line);
}

const store = new Store(DATA);
// the old passphrase (import.pass, once): kept in config.json as legacyPass so items still locked on the fridge are
// unlocked when they arrive; import.tsv (the gist's hub.tsv) is merged in once
const impPass = path.join(DATA, "import.pass"), imp = path.join(DATA, "import.tsv");
if (fs.existsSync(impPass)) {
    cfg.legacyPass = fs.readFileSync(impPass, "utf8").replace(/[\r\n]+$/, "");
    fs.writeFileSync(path.join(DATA, "config.json"), JSON.stringify(cfg, null, 1)); fs.unlinkSync(impPass);
    log("old passphrase saved: locked items will be unlocked as they arrive");
}
store.legacyPass = cfg.legacyPass || "";
if (fs.existsSync(imp)) {
    const t = fs.readFileSync(imp, "utf8");
    if (!/^#hub v1/m.test(t)) log("import.tsv is not a hub list (first line should be #hub v1) - left alone");
    else {
        store.merge(t);
        fs.renameSync(imp, path.join(DATA, "import.done.tsv"));
        const left = store.items().filter(i => i.text[0] === "~").length;
        log("imported the gist list" + (left ? " - " + left + " items are still locked (put the passphrase in import.pass and restart)" : ""));
    }
}
if (store.legacyPass) store.merge([]);       // unlock anything left from before
const auth = new Auth(DATA);
const ROOT = path.join(__dirname, "..", "..");
const { BrainHost } = require("./lib/brainhost.js");
if (!cfg.pkgToken) { cfg.pkgToken = require("crypto").randomBytes(16).toString("hex"); fs.writeFileSync(path.join(DATA, "config.json"), JSON.stringify(cfg, null, 1)); }
if (!cfg.calToken) { cfg.calToken = require("crypto").randomBytes(16).toString("hex"); fs.writeFileSync(path.join(DATA, "config.json"), JSON.stringify(cfg, null, 1)); }
const { Pusher } = require("./lib/webpush.js");
const { Books } = require("./lib/books.js");
const { Prices } = require("./lib/prices.js");
const prices = new Prices({ dataDir: DATA, log, postal: cfg.postal });
const books = new Books({ booksDir: cfg.booksDir || path.join(os.homedir(), "Documents", "Kitchen Hub Books"), dataDir: DATA, store, log });
const pusher = new Pusher(DATA, log);
const jobs = new BrainHost({ store, dataDir: DATA, log, env: cfg.jobsEnv || {}, onAlert: a => pusher.send(a).catch(() => {}) });
const server = createServer({ store, auth, dataDir: DATA, webDir: path.join(__dirname, "web"),
                              kindleDir: path.join(ROOT, "kindle", "shiftcal", "mesquite"), log, jobs, pusher, books, prices, calToken: cfg.calToken, pkgToken: cfg.pkgToken, shiftcalDir: path.join(ROOT, "kindle", "shiftcal"), port: PORT, publicUrl: cfg.publicUrl,
                              shared: { "hubdata.js": path.join(ROOT, "cloud", "hubdata.js"), "qr.js": path.join(ROOT, "kindle", "shiftcal", "mesquite", "qr.js") } });
server.on("error", e => { log("cannot start: " + e.message + (e.code === "EADDRINUSE" ? " (is the hub already running?)" : "")); process.exit(1); });
jobs.start().then(() => {
    server.listen(PORT, "0.0.0.0", () => log("Kitchen Hub " + VERSION + " on port " + PORT + ", data in " + DATA));
    const scanBooks = () => { try { books.scan(); } catch (e) { log("books: " + e.message); } };
    scanBooks(); setInterval(scanBooks, 2 * 60000);
    if (!process.argv.includes("--no-jobs")) { jobs.schedule(); setTimeout(() => jobs.run("start"), 20000); }
});
process.on("SIGINT", () => { log("stopped"); process.exit(0); });
