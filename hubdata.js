/* Kitchen Hub shared data (ES5: runs on the Kindle's old WebKit and on phones).
 *
 * The whole store is one text file of items, one per line, tab separated:
 *     ts <TAB> id <TAB> kind <TAB> state <TAB> text
 *   ts    milliseconds since 1970 when this version of the item was written
 *   id    [A-Za-z0-9._-]+, made once by the device that created the item
 *   kind  shop | sketch | recipe | note ...  ([a-z0-9:_-]+)
 *   state open | done | del
 *   text  item text with \\ \t \n escaped (sketch: stroke data, recipe: whole recipe)
 * An edit is a new line with the same id and a newer ts. Merging two copies = keep the newest line
 * per id, so any number of devices can edit offline and every copy ends up identical
 * (hub_merge.awk does exactly the same on the Kindle). Deleted items are kept 30 days so a
 * device that was offline does not bring them back.
 */
var HubData = (function() {
    var HEADER = "#hub v1", TOMB_MS = 30 * 864e5;
    var RE_TS = /^(0|[1-9][0-9]{0,14})$/, RE_ID = /^[A-Za-z0-9._-]{1,64}$/, RE_KIND = /^[a-z0-9:_-]{1,32}$/;
    var STATES = { open: 1, done: 1, del: 1 };

    // tabs/newlines escaped; other control characters and U+2028/9 (illegal in old JS strings) dropped
    function esc(s) { return String(s).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "").replace(/\n/g, "\\n").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ""); }
    function unesc(s) { return s.replace(/\\(.)/g, function(m, c) { return c === "t" ? "\t" : (c === "n" ? "\n" : c); }); }

    function parseLine(line) {
        var f = line.split("\t");
        if (f.length !== 5 || !RE_TS.test(f[0]) || !RE_ID.test(f[1]) || !RE_KIND.test(f[2]) || !STATES[f[3]] || /[\u0000-\u001f\u007f]/.test(f[4])) return null;
        return { ts: parseInt(f[0], 10), id: f[1], kind: f[2], state: f[3], text: unesc(f[4]), line: line };
    }
    function makeLine(ts, id, kind, state, text) { return ts + "\t" + id + "\t" + kind + "\t" + state + "\t" + esc(text); }

    function newer(a, b) { return a.ts !== b.ts ? a.ts > b.ts : a.line > b.line; }

    // merge any number of store texts (or arrays of lines) -> canonical store text
    function merge(texts, now) {
        var best = {}, ids = [], i, j, lines, it;
        for (i = 0; i < texts.length; i++) {
            lines = typeof texts[i] === "string" ? texts[i].split("\n") : texts[i];
            for (j = 0; j < lines.length; j++) {
                it = parseLine(lines[j].replace(/\r$/, ""));
                if (!it) continue;
                if (!best[it.id]) { best[it.id] = it; ids.push(it.id); }
                else if (newer(it, best[it.id])) best[it.id] = it;
            }
        }
        var out = [], cut = (now || new Date().getTime()) - TOMB_MS;
        for (i = 0; i < ids.length; i++) { it = best[ids[i]]; if (!(it.state === "del" && it.ts < cut)) out.push(it); }
        out.sort(function(a, b) { return a.ts !== b.ts ? a.ts - b.ts : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
        var s = HEADER + "\n";
        for (i = 0; i < out.length; i++) s += out[i].line + "\n";
        return s;
    }

    // live items of one kind, in creation order is not stored, so: oldest edit first
    function items(text, kind) {
        var lines = text.split("\n"), r = [], i, it;
        for (i = 0; i < lines.length; i++) { it = parseLine(lines[i]); if (it && it.state !== "del" && (!kind || it.kind === kind)) r.push(it); }
        return r;
    }

    // Change one item. The new version is always newer than the one being replaced, even when this
    // device's clock is behind the device that wrote it (otherwise the edit would silently lose).
    function edit(store, id, kind, state, text, now) {
        now = now || new Date().getTime();
        var lines = store.split("\n"), ts = now, i, it;
        for (i = 0; i < lines.length; i++) { it = parseLine(lines[i]); if (it && it.id === id && it.ts >= ts) ts = it.ts + 1; }
        return merge([store, makeLine(ts, id, kind, state, text)], now);
    }

    var seq = 0;
    function newId(prefix) {
        seq = (seq + 1) % 1296;
        return (prefix || "x") + new Date().getTime().toString(36) + Math.floor(Math.random() * 46656).toString(36) + seq.toString(36);
    }

    return { HEADER: HEADER, esc: esc, unesc: unesc, parseLine: parseLine, makeLine: makeLine, merge: merge, items: items, edit: edit, newId: newId };
})();
if (typeof module !== "undefined") module.exports = HubData;

/* ---------------- HubCrypt: passphrase lock for item text ----------------
 * Only the text field is locked, so the fridge's shell can still merge lines without the key.
 * text -> "~" + base64url( iv[8] | tag[8] | ciphertext )
 * key  = SHA-256 applied 1000x to "kitchenhub|" + passphrase
 * keystream block j = SHA-256(key | iv | j), tag = first 8 bytes of SHA-256(key | "t" | iv | ct)
 * Plain (unlocked) text still reads normally, so older lists keep working.
 */
var HubCrypt = (function() {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function sha256(bytes) {     // bytes: array of 0..255 -> array of 32 bytes
        var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        var l = bytes.length, m = bytes.slice(0), i, j;
        m.push(0x80);
        while (m.length % 64 !== 56) m.push(0);
        var bits = l * 8;
        m.push(0, 0, 0, Math.floor(bits / 4294967296) & 255, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
        m.splice(m.length - 8, 4); m.splice(m.length - 4, 0, 0, 0, 0, 0);
        m = m.slice(0, m.length - 4).concat([(bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255]);
        var w = new Array(64);
        for (i = 0; i < m.length; i += 64) {
            for (j = 0; j < 16; j++) w[j] = (m[i + 4 * j] << 24) | (m[i + 4 * j + 1] << 16) | (m[i + 4 * j + 2] << 8) | m[i + 4 * j + 3];
            for (j = 16; j < 64; j++) {
                var x = w[j - 15], y = w[j - 2];
                var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
                var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
            }
            var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (j = 0; j < 64; j++) {
                var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
                var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }
        var out = [];
        for (i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
        return out;
    }
    function utf8(s) { var u = unescape(encodeURIComponent(s)), o = []; for (var i = 0; i < u.length; i++) o.push(u.charCodeAt(i)); return o; }
    function unutf8(b) { var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return decodeURIComponent(escape(s)); }
    var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    function b64(b) {
        var s = "", i;
        for (i = 0; i < b.length; i += 3) {
            var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
            s += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
            if (i + 1 < b.length) s += B64.charAt((n >> 6) & 63);
            if (i + 2 < b.length) s += B64.charAt(n & 63);
        }
        return s;
    }
    function unb64(s) {
        var o = [], buf = 0, bits = 0;
        for (var i = 0; i < s.length; i++) {
            var v = B64.indexOf(s.charAt(i));
            if (v < 0) return null;
            buf = (buf << 6) | v; bits += 6;
            if (bits >= 8) { bits -= 8; o.push((buf >> bits) & 255); }
        }
        return o;
    }
    var keyCache = {};
    function keyOf(pass) {
        if (keyCache[pass]) return keyCache[pass];
        var k = utf8("kitchenhub|" + pass);
        for (var i = 0; i < 1000; i++) k = sha256(k);
        keyCache[pass] = k;
        return k;
    }
    function stream(key, iv, n) {
        var out = [], j = 0;
        while (out.length < n) { out = out.concat(sha256(key.concat(iv, [(j >>> 24) & 255, (j >>> 16) & 255, (j >>> 8) & 255, j & 255]))); j++; }
        return out;
    }
    function tag(key, iv, ct) { return sha256(key.concat([116], iv, ct)).slice(0, 8); }
    var dcache = {}, dcount = 0;
    function lock(text, pass) {
        if (!pass) return text;
        var key = keyOf(pass), pt = utf8(text), iv = [], i;
        for (i = 0; i < 8; i++) iv.push(Math.floor(Math.random() * 256));
        var ks = stream(key, iv, pt.length), ct = [];
        for (i = 0; i < pt.length; i++) ct.push(pt[i] ^ ks[i]);
        return "~" + b64(iv.concat(tag(key, iv, ct), ct));
    }
    // -> plain text; unlocked text passes through; null = locked with another passphrase
    function unlock(text, pass) {
        if (String(text).charAt(0) !== "~") return text;
        var ck = pass + "\u0001" + text;
        if (dcache.hasOwnProperty(ck)) return dcache[ck];
        var r = null;
        if (pass) {
            var b = unb64(text.substring(1));
            if (b && b.length >= 16) {
                var key = keyOf(pass), iv = b.slice(0, 8), tg = b.slice(8, 16), ct = b.slice(16), t2 = tag(key, iv, ct), ok = true, i;
                for (i = 0; i < 8; i++) if (tg[i] !== t2[i]) ok = false;
                if (ok) {
                    var ks = stream(key, iv, ct.length), pt = [];
                    for (i = 0; i < ct.length; i++) pt.push(ct[i] ^ ks[i]);
                    try { r = unutf8(pt); } catch (e) { r = null; }
                }
            }
        }
        if (dcount++ > 3000) { dcache = {}; dcount = 0; }
        dcache[ck] = r;
        return r;
    }
    function isLocked(text) { return String(text).charAt(0) === "~"; }
    function hex(b) { var s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
    return { sha256: sha256, utf8: utf8, lock: lock, unlock: unlock, isLocked: isLocked, hex: hex };
})();

/* ---------------- HubCal: shifts, events, Canada/BC statutory holidays ----------------
 * shift item: id "s"+YYYYMMDD, kind "shift", text "YYYY-MM-DD|07-15"
 * event item: kind "event", text "YYYY-MM-DD|HH:MM|Title|Note"  (HH:MM empty = all day)
 */
var HubCal = (function() {
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    function key(y, m, d) { return y + "-" + p2(m + 1) + "-" + p2(d); }
    function shiftId(k) { return "s" + k.replace(/-/g, ""); }
    function parseShift(text) { var i = String(text).indexOf("|"); return i === 10 ? { date: text.substring(0, 10), v: text.substring(11) } : null; }
    function parseEvent(text) {
        var f = String(text).split("|");
        if (f.length < 3 || !/^\d{4}-\d\d-\d\d$/.test(f[0])) return null;
        return { date: f[0], time: /^\d\d:\d\d$/.test(f[1]) ? f[1] : "", title: f[2], note: f.slice(3).join("|") };
    }
    function eventText(date, time, title, note) {
        return date + "|" + (time || "") + "|" + String(title).replace(/\|/g, "/") + "|" + String(note || "").replace(/\|/g, "/");
    }
    function fmtTime(t) {
        if (!t) return "";
        var h = parseInt(t.substring(0, 2), 10), m = t.substring(3, 5), ap = h >= 12 ? "p" : "a";
        h = h % 12; if (!h) h = 12;
        return h + (m === "00" ? "" : ":" + m) + ap;
    }
    function nth(y, m, dow, n) { var d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((dow - d + 7) % 7) + 7 * (n - 1); }
    function easter(y) {   // anonymous Gregorian algorithm
        var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
        var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
        var mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
        return [mo - 1, da];
    }
    var hcache = {};
    // statutory holidays in British Columbia, plus the federal ones most workplaces observe
    function holidays(y) {
        if (hcache[y]) return hcache[y];
        var H = {}, e = easter(y), gf = new Date(Date.UTC(y, e[0], e[1] - 2)), em = new Date(Date.UTC(y, e[0], e[1] + 1));
        function add(m, d, name) { H[key(y, m, d)] = name; }
        add(0, 1, "New Year's Day");
        add(1, nth(y, 1, 1, 3), "Family Day");
        add(gf.getUTCMonth(), gf.getUTCDate(), "Good Friday");
        add(em.getUTCMonth(), em.getUTCDate(), "Easter Monday");
        var v = 24; while (new Date(Date.UTC(y, 4, v)).getUTCDay() !== 1) v--;
        add(4, v, "Victoria Day");
        add(6, new Date(Date.UTC(y, 6, 1)).getUTCDay() === 0 ? 2 : 1, "Canada Day");
        add(7, nth(y, 7, 1, 1), "B.C. Day");
        add(8, nth(y, 8, 1, 1), "Labour Day");
        add(8, 30, "Truth & Reconciliation");
        add(9, nth(y, 9, 1, 2), "Thanksgiving");
        add(10, 11, "Remembrance Day");
        add(11, 25, "Christmas Day");
        add(11, 26, "Boxing Day");
        hcache[y] = H;
        return H;
    }
    function holiday(k) { return holidays(parseInt(k.substring(0, 4), 10))[k] || ""; }
    return { key: key, shiftId: shiftId, parseShift: parseShift, parseEvent: parseEvent, eventText: eventText, fmtTime: fmtTime, holidays: holidays, holiday: holiday };
})();
if (typeof module !== "undefined") { module.exports.HubCrypt = HubCrypt; module.exports.HubCal = HubCal; }
