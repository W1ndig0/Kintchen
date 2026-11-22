// Kitchen Hub v11: the real fridge scripts (hub_cloud.sh, sync_data.sh) talking to the real PC hub.
// The fridge's requests come from 127.0.0.1 here, so the test turns off "the PC itself is the owner" to make every
// request go through pairing + signatures, exactly like a fridge on the home network.   node tests/pc/kindle.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, "..", ".."), K = ROOT + "/kindle/shiftcal";
const HubData = require(ROOT + "/cloud/hubdata.js");
const { Store } = require(ROOT + "/pc/hub/lib/store.js");
const { Auth } = require(ROOT + "/pc/hub/lib/auth.js");
const { createServer } = require(ROOT + "/pc/hub/lib/server.js");
let pass = 0, fail = 0;
async function t(n, f) { try { await f(); pass++; console.log("PASS " + n); } catch (e) { fail++; console.log("FAIL " + n + ": " + (e && e.stack || e)); } }
// async: the PC hub runs in this same process, so the test must not block while the fridge script talks to it
const sh = (args, dir, extra) => new Promise(res => {
    const p = cp.spawn("busybox", ["sh"].concat(args), { env: Object.assign({ PATH: process.env.PATH, HUB_DIR: dir, TZ: "PCT7", HUB_VERIFY_DELAY: "0" }, extra || {}) });
    let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
    const k = setTimeout(() => p.kill(), 60000); p.on("exit", code => { clearTimeout(k); res({ code, stderr: out }); });
});

(async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "khpcK-")), store = new Store(data), auth = new Auth(data);
    fs.mkdirSync(data + "/gist/cloud", { recursive: true }); fs.mkdirSync(data + "/gist/main", { recursive: true });
    const pkgToken = "ab".repeat(16), calToken = "cd".repeat(16);
    const srv = createServer({ store, auth, dataDir: data, webDir: ROOT + "/pc/hub/web", kindleDir: K + "/mesquite", ownerLocal: false, pkgToken, calToken, port: 0,
                               rsearch: async (d, q) => "window.HUB_RSEARCH={q:" + JSON.stringify(q) + ",ts:1,items:[],ld:{}};\n" });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port, base = "http://127.0.0.1:" + port;
    // the owner pairs the fridge (desktop mode); here straight through Auth like /api/pair/kindle does
    const c = auth.newCode().code, key = auth.pair(c, "Fridge", "kindle");
    const kdir = fs.mkdtempSync(path.join(os.tmpdir(), "khK-"));
    fs.mkdirSync(kdir + "/mesquite", { recursive: true });
    ["hub_cloud.sh", "hub_merge.sh", "hub_merge.awk", "hub_common.sh", "sync_data.sh", "power_loop.sh"].forEach(f => fs.copyFileSync(K + "/" + f, kdir + "/" + f));
    const conf = "GIST_ID=\nGH_TOKEN=\nPC_URL=" + base + "\nPC_ID=" + key.id + "\nPC_KEY=" + key.secret + "\n";
    fs.writeFileSync(kdir + "/cloud.conf", conf);
    store.merge(HubData.makeLine(Date.now() - 5000, "p1", "shop", "open", "Eggs from the phone"));
    fs.writeFileSync(kdir + "/hub.tsv", "#hub v1\n" + HubData.makeLine(Date.now() - 4000, "k1", "shop", "open", "Milk from the fridge") + "\n");

    await t("fridge sync with the PC: both edits end up on both sides", async () => {
        const r = await sh([kdir + "/hub_cloud.sh", "sync"], kdir);
        const st = fs.readFileSync(kdir + "/.cloud_status", "utf8");
        assert.ok(/^ok /.test(st), "status: " + st + " log: " + (fs.existsSync(kdir + "/sync.log") ? fs.readFileSync(kdir + "/sync.log", "utf8") : "") + r.stderr);
        assert.ok(store.items().some(i => /Milk from the fridge/.test(i.text)), "PC has the fridge's item");
        const js = fs.readFileSync(kdir + "/mesquite/hub_items.js", "utf8");
        assert.ok(/Eggs from the phone/.test(js) && /Milk from the fridge/.test(js), "fridge page has both");
    });
    await t("the PC's links reach the fridge (package, extras, calendar)", () => {
        const l = fs.readFileSync(kdir + "/.cloud_links", "utf8");
        assert.ok(l.indexOf("BUNDLE_URL=http://") >= 0 && l.indexOf("/pkg/" + pkgToken + "/bundle.txt") > 0, l);
        assert.ok(/ICS_URL=.*\/cal\/cdcd/.test(l));
    });
    await t("check-in lands on the PC as kindle.json (the jobs read it)", () => {
        const k = JSON.parse(fs.readFileSync(data + "/gist/main/kindle.json", "utf8"));
        assert.ok(k.ts > 0 && typeof k.pct === "number");
        assert.ok(auth.list().find(d => d.id === key.id).seen > 0, "fridge last seen");
    });
    await t("log upload goes to the PC", async () => {
        fs.writeFileSync(kdir + "/power.log", "line one\n");
        await sh([kdir + "/hub_cloud.sh", "log"], kdir);
        assert.ok(/line one/.test(fs.readFileSync(data + "/logs/kindle-log.txt", "utf8")));
    });
    await t("a queued action reaches the fridge page as a command", async () => {
        const id = HubData.newId("q"); store.merge(HubData.makeLine(Date.now(), id, "cmd", "open", "timer|10"));
        await sh([kdir + "/hub_cloud.sh", "sync"], kdir);
        assert.ok(fs.readFileSync(kdir + "/mesquite/hub_items.js", "utf8").indexOf("timer|10") > 0);
    });
    await t("recipe search runs on the PC", async () => {
        await sh([kdir + "/hub_cloud.sh", "rsearch", "leek soup"], kdir);
        assert.ok(/HUB_RSEARCH=\{q:"leek soup"/.test(fs.readFileSync(kdir + "/mesquite/rsearch.js", "utf8")));
    });
    await t("the fridge's package comes from the PC (first-line check with a range request, then the files)", async () => {
        const now = Math.floor(Date.now() / 1000);
        fs.writeFileSync(data + "/gist/cloud/bundle.txt", "@@KH-BUNDLE " + now + "\n@@FILE mesquite/data.js\nwindow.HUB_DATA = { ts: " + now + ", articles: [] };\n@@END\n");
        const r = await sh([kdir + "/sync_data.sh"], kdir, { CURL_BIN: "curl" });
        const log = fs.readFileSync(kdir + "/sync.log", "utf8");
        assert.ok(/Cloud data: 1 files from the cloud brain/.test(log), log.slice(-600));
        assert.ok(/HUB_DATA/.test(fs.readFileSync(kdir + "/mesquite/data.js", "utf8")));
    });
    await t("a wrong key is refused and the fridge says so", async () => {
        fs.writeFileSync(kdir + "/cloud.conf", conf.replace(/PC_KEY=.*/, "PC_KEY=" + "00".repeat(32)));
        await sh([kdir + "/hub_cloud.sh", "sync"], kdir);
        assert.ok(/pair it again/.test(fs.readFileSync(kdir + "/.cloud_status", "utf8")));
    });
    await t("PC off: the fridge keeps its list and says the PC didn't answer", async () => {
        fs.writeFileSync(kdir + "/cloud.conf", conf.replace(/PC_URL=.*/, "PC_URL=http://127.0.0.1:1"));
        const before = fs.readFileSync(kdir + "/hub.tsv", "utf8");
        await sh([kdir + "/hub_cloud.sh", "sync"], kdir);
        assert.ok(/didn't answer/.test(fs.readFileSync(kdir + "/.cloud_status", "utf8")));
        assert.strictEqual(fs.readFileSync(kdir + "/hub.tsv", "utf8"), before);
    });
    await t("without the PC_ lines the fridge is back on the GitHub path (no PC request)", async () => {
        fs.writeFileSync(kdir + "/cloud.conf", "GIST_ID=\nGH_TOKEN=\n");
        await sh([kdir + "/hub_cloud.sh", "sync"], kdir);
        assert.strictEqual(fs.readFileSync(kdir + "/.cloud_status", "utf8").trim(), "not set up");
    });
    srv.close();
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
