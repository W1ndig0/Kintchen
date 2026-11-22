// Kitchen Hub v11: installing a whole new kit from a .zip (no GitHub), and the hub starting from it.   node tests/pc/kits.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");
const { install } = require(ROOT + "/pc/hub/lib/kits.js");
let pass = 0, fail = 0;
async function t(n, f) { try { await f(); pass++; console.log("PASS " + n); } catch (e) { fail++; console.log("FAIL " + n + ": " + (e && e.stack || e)); } }
function kitZip(edit) {      // a copy of this repo as "Kintchen-main/..." in a zip, like GitHub's download
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "khz-")), top = path.join(tmp, "Kintchen-main");
    fs.mkdirSync(top);
    ["kindle", "pc", "cloud"].forEach(d => cp.execSync("cp -r " + JSON.stringify(path.join(ROOT, d)) + " " + JSON.stringify(top + "/")));
    if (edit) edit(top);
    cp.execSync("cd " + JSON.stringify(tmp) + " && zip -qr kit.zip Kintchen-main");
    return fs.readFileSync(path.join(tmp, "kit.zip"));
}
const getJson = (port, p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: p }, r => { let b = ""; r.on("data", d => b += d); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej));
function startHub(data, port) {
    const p = cp.spawn(process.execPath, [ROOT + "/pc/hub/hub.js", "--data", data, "--port", String(port), "--no-jobs"], { stdio: "ignore" });
    return new Promise(r => setTimeout(() => r(p), 1500));
}
(async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "khkit-"));
    let r;
    await t("a good kit installs (found inside its top folder), version read", () => {
        r = install(data, kitZip());
        assert.ok(r.ok, JSON.stringify(r)); assert.ok(/^\d/.test(r.version)); assert.ok(/^k\d{14}\/Kintchen-main$/.test(r.dir), r.dir);
    });
    await t("refused: fridge page and scripts at different versions", () => {
        const x = install(data, kitZip(top => { const f = top + "/kindle/shiftcal/power_loop.sh"; fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^VERSION="[^"]*"/m, 'VERSION="77.0"')); }), Date.now() + 1000);
        assert.ok(/different versions/.test(x.error), JSON.stringify(x));
    });
    await t("refused: a hub file that doesn't parse", () => {
        const x = install(data, kitZip(top => fs.appendFileSync(top + "/pc/hub/lib/server.js", "\n}}} oops")), Date.now() + 2000);
        assert.ok(/doesn't parse/.test(x.error), JSON.stringify(x));
    });
    await t("refused: not a kit at all", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "khz2-")); fs.writeFileSync(tmp + "/a.txt", "x"); cp.execSync("cd " + tmp + " && zip -q n.zip a.txt");
        assert.ok(/no Kitchen Hub kit/.test(install(data, fs.readFileSync(tmp + "/n.zip"), Date.now() + 3000).error));
        assert.ok(/couldn't unpack/.test(install(data, Buffer.from("not a zip"), Date.now() + 4000).error));
    });
    await t("the hub starts from the installed kit", async () => {
        fs.writeFileSync(data + "/config.json", JSON.stringify({ kitDir: r.dir }));
        const p = await startHub(data, 8793);
        try { const k = await getJson(8793, "/api/kit"); assert.strictEqual(k.kit, r.dir); } finally { p.kill(); }
    });
    await t("a kit that won't start: the hub runs its built-in copy instead", async () => {
        fs.writeFileSync(path.join(data, "kits", r.dir, "pc/hub/main.js"), "throw new Error('broken kit');");
        const p = await startHub(data, 8794);
        try { const k = await getJson(8794, "/api/kit"); assert.strictEqual(k.kit, ""); assert.ok(/would not start/.test(fs.readFileSync(data + "/hub.log", "utf8"))); } finally { p.kill(); }
    });
    await t("the fridge's PRICE CHECK button: the PC answers in the list", async () => {
        const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "khpcb-"));
        const p = await startHub(d2, 8795);
        try {
            const HubData = require(ROOT + "/cloud/hubdata.js"), n = Date.now();
            const body = [HubData.makeLine(n, "s1", "shop", "open", "Milk"), HubData.makeLine(n, "k1", "pcreq", "open", "pricecheck")].join("\n") + "\n";
            await new Promise((res, rej) => { const q = http.request({ host: "127.0.0.1", port: 8795, method: "POST", path: "/api/store" }, r => { r.resume(); r.on("end", res); }); q.on("error", rej); q.end(body); });
            let text = "";
            for (let i = 0; i < 40 && !/\tpricecheck\tpc\topen\t/.test(text); i++) {
                await new Promise(r => setTimeout(r, 500));
                text = await new Promise(res => http.get({ host: "127.0.0.1", port: 8795, path: "/api/store" }, r => { let b = ""; r.on("data", d => b += d); r.on("end", () => res(b)); }));
            }
            assert.ok(/\tpricecheck\tpc\topen\tCheapest: /.test(text), text);
            assert.ok(/\tk1\tpcreq\tdone\t/.test(text), "the ask is marked done");
        } finally { p.kill(); }
    });
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
