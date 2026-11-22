// Kitchen Hub v11 PC hub: store, pairing, signed requests, API, virtual Kindle files.   node tests/pc/hub.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");
const HubData = require(ROOT + "/cloud/hubdata.js"), { HubCrypt } = HubData;
const { Store } = require(ROOT + "/pc/hub/lib/store.js");
const { Auth, sigFor, sha256hex } = require(ROOT + "/pc/hub/lib/auth.js");
const { createServer, homeAddr } = require(ROOT + "/pc/hub/lib/server.js");

let pass = 0, fail = 0;
async function t(name, f) { try { await f(); pass++; console.log("PASS " + name); } catch (e) { fail++; console.log("FAIL " + name + ": " + (e && e.stack || e)); } }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "khpc-"));

// the browser's pure-JS HMAC (same code as web/app.js) must equal Node's
function jsHmac(keyHex, msg) {
    const sha = HubCrypt.sha256, utf8 = HubCrypt.utf8;
    const unhex = h => { const o = []; for (let i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; };
    const hex = b => b.map(x => (x < 16 ? "0" : "") + x.toString(16)).join("");
    let k = unhex(keyHex); const ip = [], op = []; while (k.length < 64) k.push(0);
    for (let i = 0; i < 64; i++) { ip.push(k[i] ^ 0x36); op.push(k[i] ^ 0x5c); }
    return { mac: hex(sha(op.concat(sha(ip.concat(utf8(msg)))))), bodyHash: (b) => hex(sha(utf8(b))) };
}

// requests from a fake non-local address: the server sees socket.remoteAddress, so wrap it
function request(port, method, p, body, headers, fakeAddr) {
    return new Promise((res, rej) => {
        const r = http.request({ host: "127.0.0.1", port, agent: false, method, path: p, headers: Object.assign({ "X-Test-Addr": fakeAddr || "" }, headers || {}) }, (x) => {
            const c = []; x.on("data", d => c.push(d)); x.on("end", () => res({ status: x.statusCode, headers: x.headers, text: Buffer.concat(c).toString() }));
        });
        r.on("error", rej); if (body) r.write(body); r.end();
    });
}
function startServer(dir, now) {
    const store = new Store(dir), auth = new Auth(dir, now);
    const srv = createServer({ store, auth, dataDir: dir, webDir: ROOT + "/pc/hub/web", kindleDir: ROOT + "/kindle/shiftcal/mesquite", now,
                               shared: { "hubdata.js": ROOT + "/cloud/hubdata.js" } });
    // tests pretend to be another machine on the LAN by setting X-Test-Addr (only honoured here, in the test)
    srv.prependListener("request", (req) => { const a = req.headers["x-test-addr"]; if (a) Object.defineProperty(req.socket, "remoteAddress", { value: a, configurable: true }); });
    return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, store, auth, port: srv.address().port })));
}
function signed(key, method, p, body, ts) {
    ts = String(ts || Date.now()) + "." + Math.random().toString(36).slice(2, 10);
    return { "X-KH-Dev": key.id, "X-KH-Ts": ts, "X-KH-Sig": sigFor(key.secret, ts, method, p, body || "") };
}

(async () => {
    await t("store: merge, newest wins, atomic file + backup", () => {
        const d = tmp(), s = new Store(d);
        assert.ok(s.merge(HubData.makeLine(1000, "a1", "shop", "open", "Milk")));
        assert.ok(s.merge(HubData.makeLine(2000, "a1", "shop", "done", "Milk")));
        assert.ok(!s.merge(HubData.makeLine(1500, "a1", "shop", "open", "Milk")), "older line changes nothing");
        assert.strictEqual(new Store(d).items()[0].state, "done");
        assert.ok(fs.existsSync(path.join(d, "hub.tsv.bak")));
        assert.ok(!fs.readdirSync(d).some(f => /\.tmp/.test(f)));
    });
    await t("browser HMAC == Node HMAC", () => {
        const key = "ab".repeat(32), msg = "123\nPOST\n/api/store\n" + sha256hex("x\ty");
        assert.strictEqual(jsHmac(key, msg).mac, require("crypto").createHmac("sha256", Buffer.from(key, "hex")).update(msg).digest("hex"));
        assert.strictEqual(jsHmac(key, "").bodyHash("héllo"), sha256hex("héllo"));
    });
    await t("pairing code: single use, 5 wrong tries kill it, expires", () => {
        let T = 1e12; const a = new Auth(tmp(), () => T);
        assert.ok(a.pair("X", "p", "phone").error);
        const c = a.newCode().code;
        for (let i = 0; i < 5; i++) assert.ok(a.pair("WRONG000", "p", "phone").error);
        assert.ok(a.pair(c, "p", "phone").error, "dead after 5 wrong tries");
        const c2 = a.newCode().code; T += 11 * 60000;
        assert.ok(a.pair(c2, "p", "phone").error, "expired");
        const c3 = a.newCode().code, r = a.pair(c3.toLowerCase(), "Phone<script>", "phone");
        assert.ok(r.id && /^[0-9a-f]{64}$/.test(r.secret));
        assert.strictEqual(a.list()[0].name, "Phonescript");
        assert.ok(a.pair(c3, "again", "phone").error, "single use");
    });
    await t("old locked items are unlocked as they arrive, newer than the locked copy; wrong passphrase leaves them", () => {
        const d = tmp(), st = new Store(d); st.legacyPass = "pw";
        st.merge(HubData.makeLine(5, "a", "shop", "open", HubCrypt.lock("Milk", "pw")) + "\n" + HubData.makeLine(6, "b", "shop", "open", HubCrypt.lock("Ham", "other")));
        const a = st.items().find(i => i.id === "a"), b = st.items().find(i => i.id === "b");
        assert.strictEqual(a.text, "Milk"); assert.strictEqual(a.ts, 6); assert.ok(HubCrypt.isLocked(b.text));
        assert.ok(!st.merge(HubData.makeLine(5, "a", "shop", "open", HubCrypt.lock("Milk", "pw"))), "the fridge's old locked copy doesn't win back");
    });
    await t("home-network filter", () => {
        ["127.0.0.1", "::1", "192.168.1.20", "10.0.0.5", "172.20.1.1", "100.101.102.103", "::ffff:192.168.0.9", "fd7a:115c:a1e0::1"].forEach(a => assert.ok(homeAddr(a), a));
        ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860::1", ""].forEach(a => assert.ok(!homeAddr(a), a));
    });

    const dir = tmp(); const S = await startServer(dir, Date.now);
    const LAN = "192.168.1.50";
    let key;
    await t("web app shell is served without a key, with a strict CSP; hubdata.js shared", async () => {
        const r = await request(S.port, "GET", "/", null, null, LAN);
        assert.strictEqual(r.status, 200); assert.ok(/Kitchen Hub/.test(r.text)); assert.ok(/default-src 'self'/.test(r.headers["content-security-policy"]));
        assert.strictEqual((await request(S.port, "GET", "/hubdata.js", null, null, LAN)).status, 200);
        assert.strictEqual((await request(S.port, "GET", "/../hub.js", null, null, LAN)).status, 404);
    });
    await t("unpaired LAN device gets nothing; the PC itself is the owner", async () => {
        assert.strictEqual((await request(S.port, "GET", "/api/store", null, null, LAN)).status, 401);
        assert.strictEqual((await request(S.port, "GET", "/api/status")).status, 200);
    });
    await t("outside addresses are dropped", async () => {
        await assert.rejects(request(S.port, "GET", "/", null, null, "8.8.8.8"));
    });
    await t("pair over the API, then signed requests work", async () => {
        const c = JSON.parse((await request(S.port, "POST", "/api/pair/code")).text).code;
        const r = await request(S.port, "POST", "/api/pair", JSON.stringify({ code: c, name: "iPhone", kind: "phone" }), null, LAN);
        assert.strictEqual(r.status, 200); key = JSON.parse(r.text);
        const s = await request(S.port, "GET", "/api/status", null, signed(key, "GET", "/api/status"), LAN);
        assert.strictEqual(s.status, 200); assert.strictEqual(JSON.parse(s.text).you, key.id);
    });
    await t("store over the API: merge, ETag/304, plain text", async () => {
        const body = HubData.makeLine(Date.now(), "w1", "shop", "open", "Eggs|p1|2") + "\n";
        const r = await request(S.port, "POST", "/api/store", body, signed(key, "POST", "/api/store", body), LAN);
        assert.strictEqual(r.status, 200); assert.ok(/Eggs\|p1\|2/.test(r.text)); assert.strictEqual(r.headers["x-kh-changed"], "1");
        const g = await request(S.port, "GET", "/api/store", null, signed(key, "GET", "/api/store"), LAN);
        const g2 = await request(S.port, "GET", "/api/store", null, Object.assign(signed(key, "GET", "/api/store"), { "If-None-Match": g.headers.etag }), LAN);
        assert.strictEqual(g2.status, 304);
        assert.ok(/Eggs/.test(fs.readFileSync(path.join(dir, "hub.tsv"), "utf8")));
    });
    await t("tampered body, replay, old clock and wrong key are refused", async () => {
        const body = HubData.makeLine(Date.now(), "w2", "shop", "open", "Ham") + "\n";
        const h = signed(key, "POST", "/api/store", body);
        assert.strictEqual((await request(S.port, "POST", "/api/store", body.replace("Ham", "Spam"), h, "192.168.1.51")).status, 401);
        assert.strictEqual((await request(S.port, "POST", "/api/store", body, h, "192.168.1.51")).status, 200);
        assert.strictEqual((await request(S.port, "POST", "/api/store", body, h, "192.168.1.51")).status, 401, "replay");
        assert.strictEqual((await request(S.port, "GET", "/api/status", null, signed(key, "GET", "/api/status", "", Date.now() - 6 * 60000), "192.168.1.51")).status, 401);
        assert.strictEqual((await request(S.port, "GET", "/api/status", null, signed({ id: key.id, secret: "00".repeat(32) }, "GET", "/api/status"), "192.168.1.51")).status, 401);
    });
    await t("10 bad requests lock that address out for a while", async () => {
        for (let i = 0; i < 10; i++) await request(S.port, "GET", "/api/status", null, { "X-KH-Dev": "dnope" }, "192.168.1.66");
        assert.strictEqual((await request(S.port, "GET", "/api/status", null, signed(key, "GET", "/api/status"), "192.168.1.66")).status, 429);
    });
    await t("fridge queue: only known actions, cancel while queued", async () => {
        const b = JSON.stringify({ action: "rm -rf /" });
        assert.strictEqual((await request(S.port, "POST", "/api/queue", b)).status, 400);
        const q = JSON.parse((await request(S.port, "POST", "/api/queue", JSON.stringify({ action: "timer:10" }))).text);
        assert.strictEqual(q.state, "queued");
        assert.strictEqual((await request(S.port, "DELETE", "/api/queue/" + q.id)).status, 200);
        assert.strictEqual(JSON.parse((await request(S.port, "GET", "/api/queue")).text).length, 0);
    });
    await t("virtual Kindle: needs the view cookie off the PC; serves the real page and the PC's list", async () => {
        assert.strictEqual((await request(S.port, "GET", "/kindle/index.html", null, null, LAN)).status, 403);
        const v = await request(S.port, "POST", "/api/view", "", signed(key, "POST", "/api/view"), LAN);
        const cookie = v.headers["set-cookie"][0].split(";")[0];
        assert.ok(/HttpOnly/.test(v.headers["set-cookie"][0]));
        const page = await request(S.port, "GET", "/kindle/index.html", null, { Cookie: cookie }, LAN);
        assert.strictEqual(page.status, 200); assert.ok(page.text.length > 100000);
        const items = await request(S.port, "GET", "/kindle/hub_items.js", null, { Cookie: cookie }, LAN);
        global.window = {}; eval(items.text); assert.ok(window.HUB_ITEMS.lines.some(l => /Eggs/.test(l)));
        assert.strictEqual((await request(S.port, "GET", "/kindle/../../../cloud.conf.example", null, { Cookie: cookie }, LAN)).status, 404);
    });
    await t("logs bundle: hub log, devices, no keys", async () => {
        fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ legacyPass: "secret-words", port: 1 }));
        const b = await request(S.port, "GET", "/api/logs/bundle");
        assert.strictEqual(b.status, 200); assert.ok(/==== devices ====/.test(b.text) && /iPhone/.test(b.text));
        assert.ok(b.text.indexOf("secret-words") < 0 && b.text.indexOf(key.secret) < 0, "no passphrase or device key");
    });
    await t("revoked device is out", async () => {
        assert.strictEqual((await request(S.port, "DELETE", "/api/devices/" + key.id)).status, 200);
        assert.strictEqual((await request(S.port, "GET", "/api/status", null, signed(key, "GET", "/api/status"), "192.168.1.52")).status, 401);
    });
    S.srv.close();
    console.log("\n" + pass + " passed, " + fail + " failed");
    process.exit(fail ? 1 : 0);
})();
