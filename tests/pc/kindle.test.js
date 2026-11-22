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
    await t("the fridge's own alerts (timer, battery) go to the PC, not ntfy", async () => {
        const got = []; const fake = { addAlert: a => got.push(a), alerts: () => [], running: null, last: null };
        const s4 = createServer({ store, auth, dataDir: data, webDir: ROOT + "/pc/hub/web", kindleDir: K + "/mesquite", ownerLocal: false, pkgToken, calToken, jobs: fake });
        await new Promise(r => s4.listen(0, "127.0.0.1", r));
        const k4 = fs.mkdtempSync(path.join(os.tmpdir(), "khK4-")); cp.execSync("cp -r " + K + "/. " + k4 + "/");
        fs.writeFileSync(k4 + "/cloud.conf", "PC_URL=http://127.0.0.1:" + s4.address().port + "\nPC_ID=" + key.id + "\nPC_KEY=" + key.secret + "\n");
        const r = await sh([k4 + "/hub_cloud.sh", "alert", "Timer done: pasta"], k4);
        s4.close();
        assert.strictEqual(r.code, 0); assert.strictEqual(got.length, 1); assert.strictEqual(got[0].body, "Timer done: pasta");
    });
    await t("pair the fridge from its own screen (address + code), no USB", async () => {
        const k5 = fs.mkdtempSync(path.join(os.tmpdir(), "khK5-")); cp.execSync("cp -r " + K + "/. " + k5 + "/"); fs.mkdirSync(k5 + "/mesquite", { recursive: true });
        try { fs.unlinkSync(k5 + "/cloud.conf"); } catch (e) {}
        const code = auth.newCode().code;
        let r = await sh([k5 + "/hub_cloud.sh", "pair", base, "WRONGCOD"], k5);
        assert.notStrictEqual(r.code, 0); assert.ok(/refused the code/.test(fs.readFileSync(k5 + "/mesquite/pcpair.js", "utf8")));
        const code2 = auth.newCode().code;
        r = await sh([k5 + "/hub_cloud.sh", "pair", base, code2], k5);
        assert.strictEqual(r.code, 0, fs.readFileSync(k5 + "/sync.log", "utf8"));
        const c = fs.readFileSync(k5 + "/cloud.conf", "utf8");
        assert.ok(c.indexOf("PC_URL=" + base) >= 0 && /PC_ID=d[0-9a-f]{12}/.test(c) && /PC_KEY=[0-9a-f]{64}/.test(c), c);
        assert.ok(/ok:1/.test(fs.readFileSync(k5 + "/mesquite/pcpair.js", "utf8")));
        assert.ok(auth.list().some(d => d.kind === "kindle" && c.indexOf(d.id) >= 0), "the PC lists it as a fridge");
        r = await sh([k5 + "/hub_cloud.sh", "sync"], k5);
        assert.ok(/^ok /.test(fs.readFileSync(k5 + "/.cloud_status", "utf8")), "and it can sync right away");
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
    // ---- updates from the PC ----
    const newKit = fs.mkdtempSync(path.join(os.tmpdir(), "khKit-"));
    cp.execSync("cp -r " + K + "/. " + newKit + "/");
    fs.writeFileSync(newKit + "/power_loop.sh", fs.readFileSync(newKit + "/power_loop.sh", "utf8").replace(/^VERSION="[^"]*"/m, 'VERSION="99.0"'));
    fs.writeFileSync(newKit + "/mesquite/index.html", fs.readFileSync(newKit + "/mesquite/index.html", "utf8").replace(/^var VERSION = "[^"]*";/m, 'var VERSION = "99.0";'));
    const srv2 = createServer({ store, auth, dataDir: data, webDir: ROOT + "/pc/hub/web", kindleDir: K + "/mesquite", ownerLocal: false, pkgToken, calToken, shiftcalDir: newKit });
    await new Promise(r => srv2.listen(0, "127.0.0.1", r));
    const base2 = "http://127.0.0.1:" + srv2.address().port;
    const fridge = fs.mkdtempSync(path.join(os.tmpdir(), "khFr-"));
    cp.execSync("cp -r " + K + "/. " + fridge + "/");
    const conf2 = "PC_URL=" + base2 + "\nPC_ID=" + key.id + "\nPC_KEY=" + key.secret + "\n";
    await t("update check from the PC sees the new version (signed list)", async () => {
        fs.writeFileSync(fridge + "/cloud.conf", conf2);
        await sh([fridge + "/hub_update.sh", "check"], fridge);
        const u = fs.readFileSync(fridge + "/mesquite/update.js", "utf8");
        assert.ok(/state:"available"/.test(u) && /nv:"99.0"/.test(u), u + fs.readFileSync(fridge + "/sync.log", "utf8").slice(-400));
    });
    await t("update install from the PC: every file checked, new version in place", async () => {
        const r = await sh([fridge + "/hub_update.sh", "install"], fridge);
        assert.strictEqual(r.code, 0, fs.readFileSync(fridge + "/sync.log", "utf8").slice(-500));
        assert.ok(/^VERSION="99.0"/m.test(fs.readFileSync(fridge + "/power_loop.sh", "utf8")));
        assert.strictEqual(fs.readFileSync(fridge + "/hub_cloud.sh", "utf8"), fs.readFileSync(newKit + "/hub_cloud.sh", "utf8"));
    });
    await t("an update list not signed with this fridge's key is refused", async () => {
        const other = auth.pair(auth.newCode().code, "Other", "kindle");
        const f2 = fs.mkdtempSync(path.join(os.tmpdir(), "khFr2-")); cp.execSync("cp -r " + K + "/. " + f2 + "/");
        // the fridge thinks its key is X, the PC signs for the real device id: signatures can't match
        fs.writeFileSync(f2 + "/cloud.conf", "PC_URL=" + base2 + "\nPC_ID=" + other.id + "\nPC_KEY=" + "11".repeat(32) + "\n");
        await sh([f2 + "/hub_update.sh", "install"], f2);
        assert.ok(!/^VERSION="99.0"/m.test(fs.readFileSync(f2 + "/power_loop.sh", "utf8")), "nothing installed");
    });
    srv2.close();
    // ---- the book folder ----
    const { Books } = require(ROOT + "/pc/hub/lib/books.js");
    const bdir = fs.mkdtempSync(path.join(os.tmpdir(), "khBooks-")), conv = path.join(bdir, "..", "fakeconv-" + process.pid);
    fs.writeFileSync(conv, "#!/bin/sh\nprintf 'AZW3:' > \"$2\"; cat \"$1\" >> \"$2\"\n"); fs.chmodSync(conv, 0o755);
    const bookBytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
    fs.writeFileSync(bdir + "/Moby Dick - Herman Melville.txt", bookBytes);
    fs.writeFileSync(bdir + "/Emma.epub", "EPUBDATA");
    const books = new Books({ booksDir: bdir, dataDir: data, store, convert: conv });
    const srv3 = createServer({ store, auth, dataDir: data, webDir: ROOT + "/pc/hub/web", kindleDir: K + "/mesquite", ownerLocal: false, pkgToken, calToken, books });
    await new Promise(r => srv3.listen(0, "127.0.0.1", r));
    const base3 = "http://127.0.0.1:" + srv3.address().port, lib = fs.mkdtempSync(path.join(os.tmpdir(), "khLib-"));
    await t("book folder: each file becomes a book item for the fridge (EPUB converted)", () => {
        assert.strictEqual(books.scan(), 2);
        const its = store.items().filter(i => i.kind === "book"), moby = its.find(i => /^Moby Dick\|Herman Melville\|txt\|5000\|kindle\|pc/.test(i.text));
        assert.ok(moby, its.map(i => i.text).join(" / ")); assert.ok(its.some(i => /^Emma\|\|azw3\|.*\|epub$/.test(i.text)));
        assert.strictEqual(books.scan(), 0, "nothing new the second time");
    });
    await t("the fridge's own downloader fetches them from the PC into its library, checksums intact", async () => {
        fs.writeFileSync(kdir + "/cloud.conf", "PC_URL=" + base3 + "\nPC_ID=" + key.id + "\nPC_KEY=" + key.secret + "\n");
        await sh([kdir + "/hub_cloud.sh", "sync"], kdir);       // gets BOOKS_URL
        assert.ok(/BOOKS_URL=/.test(fs.readFileSync(kdir + "/.cloud_links", "utf8")));
        fs.copyFileSync(K + "/hub_books.sh", kdir + "/hub_books.sh");
        const ids = store.items().filter(i => i.kind === "book");
        // what the fridge page writes (bookName): "Title - Author.ext"
        fs.writeFileSync(kdir + "/.books_want", ids.map(i => { const f = i.text.split("|"); return i.id + "\t" + (f[1] ? f[0] + " - " + f[1] : f[0]) + "." + f[2]; }).join("\n") + "\n");
        await sh([kdir + "/hub_books.sh"], kdir, { HUB_LIB: lib, CURL_BIN: "curl" });
        assert.ok(fs.readFileSync(lib + "/Moby Dick - Herman Melville.txt").equals(bookBytes), fs.readFileSync(kdir + "/sync.log", "utf8").slice(-500));
        assert.strictEqual(fs.readFileSync(lib + "/Emma.azw3", "utf8"), "AZW3:EPUBDATA");
    });
    await t("taking a book out of the folder takes it off the fridge", async () => {
        fs.unlinkSync(bdir + "/Emma.epub"); assert.strictEqual(books.scan(), 1);
        assert.ok(!store.items().some(i => i.kind === "book" && /^Emma/.test(i.text)));
        fs.writeFileSync(kdir + "/.books_want", fs.readFileSync(kdir + "/.books_want", "utf8").split("\n").filter(l => !/Emma/.test(l)).join("\n"));
        await sh([kdir + "/hub_books.sh"], kdir, { HUB_LIB: lib, CURL_BIN: "curl" });
        assert.ok(!fs.existsSync(lib + "/Emma.azw3") && fs.existsSync(lib + "/Moby Dick - Herman Melville.txt"));
    });
    await t("a big book goes in parts (the fridge's small RAM disk) and the fridge's downloader puts it back together", async () => {
        const big = require("crypto").randomBytes(4200000);          // 3 parts of up to 1.5 MB
        fs.writeFileSync(bdir + "/Big One - Someone.pdf", big);
        assert.strictEqual(books.scan(), 1);
        const it = store.items().find(i => i.kind === "book" && /^Big One/.test(i.text));
        const meta = await (await fetch(base3 + "/books/" + pkgToken + "/bk_" + it.id + ".meta")).text();
        assert.strictEqual(meta.trim().split(" ")[3], "3", meta);
        assert.strictEqual((await fetch(base3 + "/books/" + pkgToken + "/bk_" + it.id + ".p3")).status, 404, "no part past the end");
        const p0 = await (await fetch(base3 + "/books/" + pkgToken + "/bk_" + it.id + ".p0")).text();
        assert.ok(p0.length < 2200000, "a part is about 2 MB of base64, not the whole book (" + p0.length + ")");
        fs.writeFileSync(kdir + "/.books_want", fs.readFileSync(kdir + "/.books_want", "utf8").trim() + "\n" + it.id + "\tBig One - Someone.pdf\n");
        await sh([kdir + "/hub_books.sh"], kdir, { HUB_LIB: lib, CURL_BIN: "curl" });
        assert.ok(fs.existsSync(lib + "/Big One - Someone.pdf") && fs.readFileSync(lib + "/Big One - Someone.pdf").equals(big), fs.readFileSync(kdir + "/sync.log", "utf8").slice(-400));
    });
    srv3.close();
    srv.close();
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
