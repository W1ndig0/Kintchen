// Kitchen Hub v11: web push encryption (RFC 8291) and VAPID, decrypted here as a phone would.   node tests/pc/push.test.js
"use strict";
const assert = require("assert"), crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");
const { Pusher, encrypt, vapidHeader, vapidKeys, b64u, unb64u } = require(ROOT + "/pc/hub/lib/webpush.js");
let pass = 0, fail = 0;
async function t(n, f) { try { await f(); pass++; console.log("PASS " + n); } catch (e) { fail++; console.log("FAIL " + n + ": " + (e && e.stack || e)); } }
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

function phone() {      // the receiving side: its keys, and RFC 8291 decryption
    const ec = crypto.createECDH("prime256v1"); ec.generateKeys();
    const auth = crypto.randomBytes(16);
    return {
        sub: { p256dh: b64u(ec.getPublicKey()), auth: b64u(auth) },
        decrypt(body) {
            const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
            const shared = ec.computeSecret(asPub);
            const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ec.getPublicKey(), asPub, Buffer.from([1])])).subarray(0, 32);
            const prk = hmac(salt, ikm);
            const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
            const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
            const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
            const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
            assert.strictEqual(pt[pt.length - 1], 2, "padding delimiter"); return pt.subarray(0, pt.length - 1).toString();
        }
    };
}
(async () => {
    await t("RFC 8291 round trip: the phone decrypts what the PC sends", () => {
        const ph = phone(), body = encrypt('{"title":"Hi","body":"Shift at 7"}', ph.sub.p256dh, ph.sub.auth);
        assert.strictEqual(body.readUInt32BE(16), 4096); assert.strictEqual(body[20], 65);
        assert.strictEqual(ph.decrypt(body), '{"title":"Hi","body":"Shift at 7"}');
    });
    await t("RFC 8291 appendix A test vector", () => {
        const body = encrypt("When I grow up, I want to be a watermelon",
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            "BTBZMqHH6r4Tts7J_aSIgg",
            { asPriv: unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), salt: unb64u("DGv6ra1nlYgDCS1FRnbzlw") });
        assert.strictEqual(b64u(body), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
    });
    await t("VAPID header is a valid ES256 JWT for the push service's origin", () => {
        const k = vapidKeys(fs.mkdtempSync(path.join(os.tmpdir(), "khv-")));
        const h = vapidHeader("https://web.push.apple.com/abc", k, null, 1e12);
        const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h); assert.ok(m);
        const claims = JSON.parse(unb64u(m[2])); assert.strictEqual(claims.aud, "https://web.push.apple.com");
        const pub = unb64u(m[4]);
        const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" });
        assert.ok(crypto.verify("sha256", Buffer.from(m[1] + "." + m[2]), { key, dsaEncoding: "ieee-p1363" }, unb64u(m[3])));
    });
    await t("Pusher: delivers, honours quiet hours, removes dead subscriptions", async () => {
        const got = []; let gone = false;
        const srv = http.createServer((req, res) => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => { got.push({ h: req.headers, b: Buffer.concat(c) }); res.writeHead(gone ? 410 : 201); res.end(); }); });
        await new Promise(r => srv.listen(0, "127.0.0.1", r));
        const P = new Pusher(fs.mkdtempSync(path.join(os.tmpdir(), "khp-")));
        const ph = phone();
        assert.ok(!P.subscribe("d1", { endpoint: "http://insecure", keys: ph.sub }), "https only");
        P.subscribe("d1", { endpoint: "https://x", keys: ph.sub });
        P.subs.d1.endpoint = "http://127.0.0.1:" + srv.address().port + "/p";      // the test's fake push service
        P.settings("d1", { on: true, quietFrom: 0, quietTo: 0 });
        assert.strictEqual(await P.send({ title: "T", body: "B" }), 1);
        assert.strictEqual(JSON.parse(ph.decrypt(got[0].b)).body, "B"); assert.strictEqual(got[0].h["content-encoding"], "aes128gcm");
        const hr = new Date().getHours();
        P.settings("d1", { on: true, quietFrom: hr, quietTo: (hr + 1) % 24 });
        assert.strictEqual(await P.send({ title: "T", body: "quiet" }), 0, "quiet hours");
        assert.strictEqual(await P.send({ title: "T", body: "urgent", prio: 5 }), 1, "urgent goes through");
        gone = true; await P.send({ title: "T", body: "x", prio: 5 });
        assert.ok(!P.subs.d1, "410 removes the subscription");
        srv.close();
    });
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
