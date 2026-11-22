/* Kitchen Hub v11 - the hub on the PC (started by hub.js, which picks the newest installed kit). 
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
const ROOT = path.join(__dirname, "..", "..");      // the kit this code came from (repo folder, or an installed kit)
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
                              kindleDir: path.join(ROOT, "kindle", "shiftcal", "mesquite"), log, jobs, pusher, books, prices, calToken: cfg.calToken, pkgToken: cfg.pkgToken, shiftcalDir: path.join(ROOT, "kindle", "shiftcal"), port: PORT,
                              onPriceCheck: publishPrice, onRestart: () => { log("restarting for the new kit"); process.exit(75); }, publicUrl: cfg.publicUrl,
                              shared: { "hubdata.js": path.join(ROOT, "cloud", "hubdata.js"), "qr.js": path.join(ROOT, "kindle", "shiftcal", "mesquite", "qr.js") } });
// the fridge's PRICE CHECK button: an open "pcreq" item "pricecheck" -> the check runs here, the answer goes back as
// the "pc" item "pricecheck" (shown under the fridge's list) and to the phone as an alert
const HubData = require("../../cloud/hubdata.js");
function publishPrice(r) {
    const old = HubData.items(store.text, "pc").find(i => i.id === "pricecheck");
    if (r && r.summary && (!old || old.text !== r.summary)) store.merge(HubData.makeLine(Math.max(Date.now(), old ? old.ts + 1 : 0), "pricecheck", "pc", "open", r.summary.slice(0, 300)));
}
let priceBusy = false;
store.onChange(() => {
    if (priceBusy) return;
    const asks = HubData.items(store.text, "pcreq").filter(i => i.state === "open" && i.text === "pricecheck");
    if (!asks.length) return;
    priceBusy = true;
    const done = () => { store.merge(asks.map(a => HubData.makeLine(Math.max(Date.now(), a.ts + 1), a.id, "pcreq", "done", "pricecheck"))); priceBusy = false; };
    const list = HubData.items(store.text, "shop").filter(i => i.state === "open" && i.text[0] !== "~").map(i => { const x = HubData.HubCal.parseShop(i.text); return { name: x.name, qty: x.qty }; }).filter(i => i.name);
    if (!list.length) { publishPrice({ summary: "The list is empty." }); done(); return; }
    prices.check(list).then(r => { publishPrice(r); pusher.send({ title: "Price check", body: r.summary, prio: 3, cat: "price" }).catch(() => {}); log("price check asked by the fridge"); })
          .catch(e => log("price check failed: " + e.message)).then(done, done);
});
server.on("error", e => { log("cannot start: " + e.message + (e.code === "EADDRINUSE" ? " (is the hub already running?)" : "")); process.exit(1); });
jobs.start().then(() => {
    server.listen(PORT, "0.0.0.0", () => log("Kitchen Hub " + VERSION + " on port " + PORT + ", data in " + DATA));
    const scanBooks = () => { try { books.scan(); } catch (e) { log("books: " + e.message); } };
    scanBooks(); setInterval(scanBooks, 2 * 60000);
    if (!process.argv.includes("--no-jobs")) { jobs.schedule(); setTimeout(() => { const m = new Date().getMinutes(); if (!((m >= 0 && m < 7) || (m >= 30 && m < 37))) jobs.run("start"); }, 20000); }      // not when a scheduled run is due within minutes (that would run twice)
});
process.on("SIGINT", () => { log("stopped"); process.exit(0); });
