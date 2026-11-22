/* Kitchen Hub v11 - web push from the PC to the phone's home-screen app (no extra packages).
 * Message encryption: RFC 8291 (aes128gcm, RFC 8188). Sender identity: VAPID (RFC 8292), keys made once in vapid.json.
 * The PC sends out through the phone's push service (Apple for an iPhone), so alerts arrive with Tailscale off,
 * as long as the PC is online. Messages carry short text only. */
"use strict";
const crypto = require("crypto"), fs = require("fs"), path = require("path");
const { atomicWrite } = require("./store.js");

const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

function vapidKeys(dir) {
    const f = path.join(dir, "vapid.json");
    try { const k = JSON.parse(fs.readFileSync(f, "utf8")); if (k.pub && k.priv) return k; } catch (e) {}
    const ec = crypto.createECDH("prime256v1"); ec.generateKeys();
    const k = { pub: b64u(ec.getPublicKey()), priv: b64u(ec.getPrivateKey()) };
    atomicWrite(f, JSON.stringify(k));
    return k;
}
function privKeyObject(k) {
    const pub = unb64u(k.pub);
    return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: k.priv, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
}
function vapidHeader(endpoint, k, subject, now) {
    const aud = new URL(endpoint).origin;
    const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const body = b64u(JSON.stringify({ aud, exp: Math.floor((now || Date.now()) / 1000) + 12 * 3600, sub: subject || "mailto:kitchen-hub@localhost" }));
    const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key: privKeyObject(k), dsaEncoding: "ieee-p1363" });
    return "vapid t=" + head + "." + body + "." + b64u(sig) + ", k=" + k.pub;
}
// -> Buffer body for the push service
function encrypt(payload, p256dh, auth, opts) {
    opts = opts || {};
    const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
    const ec = crypto.createECDH("prime256v1");
    if (opts.asPriv) ec.setPrivateKey(opts.asPriv); else ec.generateKeys();
    const asPub = ec.getPublicKey(), shared = ec.computeSecret(uaPub);
    const salt = opts.salt || crypto.randomBytes(16);
    const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub, Buffer.from([1])])).subarray(0, 32);
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
    const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
    const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
    const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
    return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

// alert kinds, for per-device on/off (desktop mode > Status > alerts). Worked out from the alert's title when the
// job that sent it didn't say.
const CATS = [["briefing", "Morning briefing"], ["week", "Sunday week ahead"], ["shifts", "Shifts"], ["events", "Events and reminders"],
              ["birthdays", "Birthdays and anniversaries"], ["holidays", "Holidays"], ["shopping", "Shopping day"], ["food", "Food to use up / running low"],
              ["deals", "Deals and price drops"], ["bills", "Bills, budget and payday"], ["fridge", "The fridge (battery, timers, gone quiet)"], ["price", "Price check results"]];
function catOf(a) {
    if (a.cat) return a.cat;
    const t = String(a.title || "") + " " + String(a.tags || "");
    if (/^Good morning/.test(t)) return "briefing";
    if (/^Your week/.test(t)) return "week";
    if (/fridge|Kitchen Hub battery|timer|went quiet/i.test(t)) return "fridge";
    if (/shift/i.test(t)) return "shifts";
    if (/birthday|anniversar/i.test(t)) return "birthdays";
    if (/^Tomorrow is /.test(t)) return "holidays";
    if (/things? on the list|shopping/i.test(t)) return "shopping";
    if (/use it up|pantry|running low/i.test(t)) return "food";
    if (/price drop|target hit|on sale|hot deal/i.test(t)) return "deals";
    if (/bill|budget|payday/i.test(t)) return "bills";
    if (/price check/i.test(t)) return "price";
    return "events";
}
class Pusher {
    constructor(dir, log) {
        this.dir = dir; this.log = log || (() => {});
        this.keys = vapidKeys(dir);
        this.file = path.join(dir, "push.json");
        try { this.subs = JSON.parse(fs.readFileSync(this.file, "utf8")) || {}; } catch (e) { this.subs = {}; }
    }
    save() { atomicWrite(this.file, JSON.stringify(this.subs, null, 1)); }
    // one subscription per device; settings: { on, quietFrom, quietTo } (hours, 0-23; equal = no quiet hours)
    subscribe(device, sub) {
        if (!sub || !/^https:\/\//.test(sub.endpoint || "") || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
        const old = this.subs[device] || {};
        this.subs[device] = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, settings: old.settings || { on: true, quietFrom: 22, quietTo: 7 } };
        this.save(); return true;
    }
    unsubscribe(device) { delete this.subs[device]; this.save(); }
    settings(device, s) {
        const x = this.subs[device]; if (!x) return null;
        if (s) {
            const h = (v, d) => (Number.isInteger(+v) && +v >= 0 && +v <= 23) ? +v : d;
            const off = {}; (Array.isArray(s.off) ? s.off : Object.keys(x.settings.off || {})).forEach(k => { if (CATS.some(c => c[0] === k)) off[k] = 1; });
            x.settings = { on: s.on !== false, quietFrom: h(s.quietFrom, x.settings.quietFrom), quietTo: h(s.quietTo, x.settings.quietTo), off };
            this.save();
        }
        return x.settings;
    }
    quiet(s, d) {
        const hr = (d || new Date()).getHours();
        if (s.quietFrom === s.quietTo) return false;
        return s.quietFrom < s.quietTo ? hr >= s.quietFrom && hr < s.quietTo : hr >= s.quietFrom || hr < s.quietTo;
    }
    async send(alert, now) {
        const payload = JSON.stringify({ title: String(alert.title || "Kitchen Hub").slice(0, 80), body: String(alert.body || "").slice(0, 400) });
        let n = 0;
        for (const dev of Object.keys(this.subs)) {
            const s = this.subs[dev];
            if (!s.settings.on || (s.settings.off && s.settings.off[catOf(alert)]) || (this.quiet(s.settings, now) && (alert.prio || 3) < 5)) continue;
            try {
                const r = await fetch(s.endpoint, { method: "POST", body: encrypt(payload, s.keys.p256dh, s.keys.auth),
                    headers: { Authorization: vapidHeader(s.endpoint, this.keys), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
                               TTL: "43200", Urgency: (alert.prio || 3) >= 4 ? "high" : "normal" }, signal: AbortSignal.timeout(20000) });
                if (r.status === 404 || r.status === 410) { this.log("push: " + dev + " subscription gone - removed"); delete this.subs[dev]; this.save(); }
                else if (r.ok) n++; else this.log("push: " + dev + " -> " + r.status);
            } catch (e) { this.log("push: " + dev + " failed (" + e.message + ")"); }
        }
        return n;
    }
}
module.exports = { CATS, catOf, Pusher, encrypt, vapidHeader, vapidKeys, b64u, unb64u };
