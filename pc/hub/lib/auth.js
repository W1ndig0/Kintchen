/* Kitchen Hub v11 - who may talk to the hub.
 *
 * The PC itself (requests from 127.0.0.1 / ::1, i.e. the tray's browser window) is the owner and needs no key.
 * Every other device pairs once:
 *   1. desktop mode on the PC makes a pairing code (8 characters, single use, 10 minutes, 5 wrong tries kill it)
 *   2. the device sends the code to POST /api/pair and gets back its own id + secret (32 random bytes)
 *   3. every later request is signed:
 *        X-KH-Dev: <id>   X-KH-Ts: <ms since 1970>.<random>  (the random part lets two identical requests in one ms both count)
 *          X-KH-Sig: hex HMAC-SHA256(secret, ts \n METHOD \n path \n sha256hex(body))
 *      A request more than 5 minutes off the PC's clock, or a signature seen before, is refused (no replay).
 * Devices are listed in desktop mode and can be revoked. Secrets are stored in devices.json in the data folder
 * (readable only by the Windows user the hub runs as). */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { atomicWrite } = require("./store.js");

const CODE_MS = 10 * 60000, CODE_TRIES = 5, SKEW_MS = 5 * 60000;
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";     // no 0/O/1/I/L

function sha256hex(b) { return crypto.createHash("sha256").update(b || "").digest("hex"); }
function sigFor(secret, ts, method, p, body) {
    return crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(ts + "\n" + method + "\n" + p + "\n" + sha256hex(body)).digest("hex");
}
function isLocal(addr) { return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"; }

class Auth {
    constructor(dir, now) {
        this.file = path.join(dir, "devices.json");
        this.now = now || Date.now;
        this.devices = {};
        try { this.devices = JSON.parse(fs.readFileSync(this.file, "utf8")) || {}; } catch (e) { this.devices = {}; }
        this.code = null;          // { code, until, tries }
        this.seen = new Map();     // sig -> time, for replay checks
        this.fails = new Map();    // address -> { n, until } lockout
    }
    save() { atomicWrite(this.file, JSON.stringify(this.devices, null, 1)); }
    list() {
        return Object.keys(this.devices).map(id => {
            const d = this.devices[id];
            return { id, name: d.name, kind: d.kind, added: d.added, seen: d.seen || 0, addr: d.addr || "" };
        });
    }
    newCode() {
        let c = ""; const r = crypto.randomBytes(8);
        for (let i = 0; i < 8; i++) c += ALPHA[r[i] % ALPHA.length];
        this.code = { code: c, until: this.now() + CODE_MS, tries: 0 };
        return { code: c, until: this.code.until };
    }
    pair(code, name, kind) {
        const c = this.code;
        if (!c || this.now() > c.until) { this.code = null; return { error: "no pairing code is active - make one in desktop mode on the PC" }; }
        if (String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== c.code) {
            if (++c.tries >= CODE_TRIES) this.code = null;
            return { error: "wrong code" };
        }
        this.code = null;
        const id = "d" + crypto.randomBytes(6).toString("hex"), secret = crypto.randomBytes(32).toString("hex");
        this.devices[id] = { name: String(name || "device").replace(/[^\w .'-]/g, "").slice(0, 40) || "device",
                             kind: /^(phone|computer|kindle)$/.test(kind) ? kind : "phone", secret, added: this.now() };
        this.save();
        return { id, secret };
    }
    revoke(id) { if (!this.devices[id]) return false; delete this.devices[id]; this.save(); return true; }
    rename(id, name) { const d = this.devices[id]; if (!d) return false; d.name = String(name || "").replace(/[^\w .'-]/g, "").slice(0, 40) || d.name; this.save(); return true; }

    locked(addr) { const f = this.fails.get(addr); return !!(f && f.until > this.now()); }
    failed(addr) {
        const f = this.fails.get(addr) || { n: 0, until: 0 };
        f.n++; if (f.n >= 10) { f.until = this.now() + 15 * 60000; f.n = 0; }
        this.fails.set(addr, f);
    }
    // -> { who: "owner" | device id } or { error }
    check(req, body, ownerLocal) {
        const addr = req.socket.remoteAddress;
        if (ownerLocal !== false && isLocal(addr)) return { who: "owner" };
        if (this.locked(addr)) return { error: "too many bad requests - try again later", code: 429 };
        const id = req.headers["x-kh-dev"], ts = req.headers["x-kh-ts"], sig = req.headers["x-kh-sig"];
        const d = id && this.devices[id];
        const bad = (m) => { this.failed(addr); return { error: m, code: 401 }; };
        if (!d || !/^\d{12,15}(\.[0-9a-z]{1,16})?$/.test(ts || "") || !/^[0-9a-f]{64}$/.test(sig || "")) return bad("not paired");
        if (Math.abs(this.now() - Number(ts.split(".")[0])) > SKEW_MS) return bad("clock is more than 5 minutes off");
        const want = sigFor(d.secret, ts, req.method, req.url, body);
        if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return bad("bad signature");
        const t = this.now();
        for (const [k, v] of this.seen) if (t - v > 2 * SKEW_MS) this.seen.delete(k);
        if (this.seen.has(sig)) return bad("request was already used");
        this.seen.set(sig, t);
        if (t - (d.seen || 0) > 60000 || d.addr !== addr) { d.seen = t; d.addr = addr; this.save(); }
        return { who: id, device: d };
    }
}
module.exports = { Auth, sigFor, sha256hex, isLocal };
