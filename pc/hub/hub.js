#!/usr/bin/env node
/* Kitchen Hub v11 - the hub on the PC. Start: node pc/hub/hub.js   (install.ps1 makes Windows start it at boot)
 *
 * Data folder: %LOCALAPPDATA%\KitchenHub on Windows, ~/.kitchenhub elsewhere, or KH_DATA.
 *   hub.tsv (+ .bak)   the list, plain text        devices.json   paired devices
 *   queue.json         actions for the fridge       config.json    { "port": 8770 }
 *   hub.log            what happened (rotated at 1 MB)
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
const imp = path.join(DATA, "import.tsv"), impPass = path.join(DATA, "import.pass");
if (fs.existsSync(imp)) {
    const t = fs.readFileSync(imp, "utf8");
    if (!/^#hub v1/m.test(t)) log("import.tsv is not a hub list (first line should be #hub v1) - left alone");
    else {
        // v11 stores plain text: locked lines from the gist are unlocked with the passphrase in import.pass (deleted after)
        const pass = fs.existsSync(impPass) ? fs.readFileSync(impPass, "utf8").replace(/[\r\n]+$/, "") : "";
        const { importLines } = require("./lib/import.js");
        const r = importLines(t, pass);
        if (r.stillLocked && !pass) log("import.tsv has " + r.stillLocked + " locked items: put your passphrase in import.pass next to it and restart");
        else {
            store.merge(r.text);
            fs.renameSync(imp, path.join(DATA, "import.done.tsv"));
            log("imported " + r.total + " items (" + r.unlocked + " unlocked" + (r.stillLocked ? ", " + r.stillLocked + " could not be unlocked and were skipped" : "") + ")");
        }
        if (fs.existsSync(impPass)) fs.unlinkSync(impPass);
    }
}
const auth = new Auth(DATA);
const ROOT = path.join(__dirname, "..", "..");
const server = createServer({ store, auth, dataDir: DATA, webDir: path.join(__dirname, "web"),
                              kindleDir: path.join(ROOT, "kindle", "shiftcal", "mesquite"), log,
                              shared: { "hubdata.js": path.join(ROOT, "cloud", "hubdata.js"), "qr.js": path.join(ROOT, "kindle", "shiftcal", "mesquite", "qr.js") } });
server.on("error", e => { log("cannot start: " + e.message + (e.code === "EADDRINUSE" ? " (is the hub already running?)" : "")); process.exit(1); });
server.listen(PORT, "0.0.0.0", () => log("Kitchen Hub " + VERSION + " on port " + PORT + ", data in " + DATA));
process.on("SIGINT", () => { log("stopped"); process.exit(0); });
