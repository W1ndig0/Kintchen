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
        // 64-bit big-endian message length (high word is 0 for anything under 512 MB)
        m.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
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
    // 9.9: an optional 5th field says whose it is: p1 (you), p2 (roommate) or nothing/all (shared)
    function parseEvent(text) {
        var f = String(text).split("|");
        if (f.length < 3 || !/^\d{4}-\d\d-\d\d$/.test(f[0])) return null;
        var who = f.length >= 5 && /^(p1|p2|all)?$/.test(f[f.length - 1]) ? f.pop() : "";
        return { date: f[0], time: /^\d\d:\d\d$/.test(f[1]) ? f[1] : "", title: f[2], note: f.slice(3).join("|"), who: who === "all" ? "" : who };
    }
    function eventText(date, time, title, note, who) {
        return date + "|" + (time || "") + "|" + String(title).replace(/\|/g, "/") + "|" + String(note || "").replace(/\|/g, "/") + (who ? "|" + who : "");
    }
    // shifts: "s20261117" = you, "q20261117" = your roommate (same text "YYYY-MM-DD|value")
    function shiftIdFor(k, who) { return (who === "p2" ? "q" : "s") + k.replace(/-/g, ""); }
    function whoOfShift(id) { return String(id).charAt(0) === "q" ? "p2" : "p1"; }
    // shopping items: "Milk" or "Milk|p2|2|the 2% one"  (name | who added it | how many | note)
    function parseShop(text) {
        var f = String(text || "").split("|");
        return { name: f[0], who: /^p[12]$/.test(f[1] || "") ? f[1] : "", qty: Math.max(1, parseInt(f[2], 10) || 1), note: f.slice(3).join(" ") };
    }
    function shopText(name, who, qty, note) {
        var c = function(x) { return String(x || "").replace(/\|/g, "/"); };
        if (!who && (!qty || qty === 1) && !note) return c(name);
        return c(name) + "|" + (who || "") + "|" + (qty && qty > 1 ? qty : "") + (note ? "|" + c(note) : "");
    }
    // "10:45-2:45p" "1-7:15p" "07-15" "9-5" "7a-3:30p" "22-6" -> {s: minutes, e: minutes (may pass 1440)} | null
    function shiftSpan(v) {
        var m = /^\s*(\d{1,2})(?::?(\d\d))?\s*([ap])?m?\s*(?:-|\u2013|to)\s*(\d{1,2})(?::?(\d\d))?\s*([ap])?m?/i.exec(String(v || ""));
        if (!m) return null;
        var sh = +m[1], sm = +(m[2] || 0), eh = +m[4], em = +(m[5] || 0), sa = (m[3] || "").toLowerCase(), ea = (m[6] || "").toLowerCase();
        if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null;
        if (sa === "p" && sh < 12) sh += 12; if (sa === "a" && sh === 12) sh = 0;
        if (ea === "p" && eh < 12) eh += 12; if (ea === "a" && eh === 12) eh = 0;
        // 10.1.2: "1-7" / "1-7:15p" start in the afternoon, but "6-2" / "6-2p" / "5-1" are morning shifts (was 6pm-2am / 20 h)
        if (!sa && m[1].charAt(0) !== "0" && sh < 7) {
            if (ea === "p") { if ((sh + 12) * 60 + sm < eh * 60 + em) sh += 12; }
            else if (!ea && (eh > sh || (eh === sh && em > sm))) sh += 12;
        }
        var s = sh * 60 + sm, e = eh * 60 + em;
        if (!ea && e <= s && eh < 12 && eh + 12 > sh) e += 720;          // "9-5"
        if (!ea && eh === 12 && e <= s) e = 1440 + em;                   // 10.1.2: "4-12" ends at midnight (was noon the next day)
        if (e <= s) e += 1440;                                            // overnight "22-6"
        return { s: s, e: e };
    }
    /* Pay (B.C. Employment Standards defaults, all switchable):
     *   unpaid 30-min meal break on shifts over 5 h; daily overtime 1.5x after 8 h, 2x after 12 h;
     *   weekly overtime 1.5x after 40 regular hours (Sun-Sat); working a stat holiday 1.5x (first 12 h, 2x after).
     * cfg: {rate, cycle: weekly|biweekly|semimonthly, start: "YYYY-MM-DD" (any first day of a period),
     *       payLag: days from period end to payday, brk: 0|1, ot: 0|1, stat: 0|1}
     * shifts: {date: value}. Returns {from, to, payday, reg, ot15, ot2, hours, gross, days: [{k, v, h, pay}]}     */
    function periodOf(k, cfg) {
        var d = dayNum(k), y = +k.substring(0, 4), mo = +k.substring(5, 7) - 1, dom = +k.substring(8, 10), from, to;
        if (cfg.cycle === "semimonthly") {
            if (dom <= 15) { from = key(y, mo, 1); to = key(y, mo, 15); }
            else { from = key(y, mo, 16); to = key(y, mo, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()); }
        } else {
            var len = cfg.cycle === "weekly" ? 7 : 14, a = dayNum(cfg.start || "2026-01-04"), off = ((d - a) % len + len) % len;
            from = keyN(d - off); to = keyN(d - off + len - 1);
        }
        return { from: from, to: to, payday: keyN(dayNum(to) + (cfg.payLag === undefined ? 6 : +cfg.payLag)) };
    }
    function keyN(n) { var x = new Date(n * 86400000); return key(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); }
    function payFor(shifts, fromK, toK, cfg) {
        var rate = +cfg.rate || 0, out = { from: fromK, to: toK, reg: 0, ot15: 0, ot2: 0, hours: 0, gross: 0, days: [] };
        var weekReg = {}, n0 = dayNum(fromK), n1 = dayNum(toK);
        if (cfg.ot !== 0) for (var pn = n0 - new Date(n0 * 86400000).getUTCDay(); pn < n0; pn++) {   // 10.1.2: a period that starts mid-week still knows the week's earlier hours
            var pv = shifts[keyN(pn)], psp = pv ? shiftSpan(pv) : null; if (!psp) continue;
            var ph = (psp.e - psp.s) / 60; if (cfg.brk !== 0 && ph > 5) ph -= 0.5;
            var pw = pn - new Date(pn * 86400000).getUTCDay(); weekReg[pw] = Math.min(40, (weekReg[pw] || 0) + Math.min(ph, 8));
        }
        for (var n = n0; n <= n1; n++) {
            var k = keyN(n), v = shifts[k], sp = v ? shiftSpan(v) : null;
            if (!sp) continue;
            var h = (sp.e - sp.s) / 60;
            if (cfg.brk !== 0 && h > 5) h -= 0.5;
            var r = h, o15 = 0, o2 = 0;
            if (cfg.ot !== 0) { if (h > 12) { o2 = h - 12; o15 = 4; r = 8; } else if (h > 8) { o15 = h - 8; r = 8; } }
            var wk = n - new Date(n * 86400000).getUTCDay();                  // the Sunday of that week
            if (cfg.ot !== 0) { var before = weekReg[wk] || 0; if (before + r > 40) { var over = before + r - Math.max(40, before); o15 += over; r -= over; } weekReg[wk] = before + r; }
            var mult = cfg.stat !== 0 && holiday(k) && !/Easter Monday|Boxing Day/.test(holiday(k)) ? 1.5 : 1, pay;      // 10.1.2: those two aren't B.C. stats
            if (mult > 1) pay = rate * (Math.min(h, 12) * 1.5 + Math.max(0, h - 12) * 2);
            else pay = rate * (r + o15 * 1.5 + o2 * 2);
            out.reg += r; out.ot15 += o15; out.ot2 += o2; out.hours += h; out.gross += pay;
            out.days.push({ k: k, v: v, h: Math.round(h * 100) / 100, pay: Math.round(pay * 100) / 100, stat: mult > 1 });
        }
        ["reg", "ot15", "ot2", "hours"].forEach(function(f) { out[f] = Math.round(out[f] * 100) / 100; });
        out.gross = Math.round(out.gross * 100) / 100;
        return out;
    }
    /* 10.0 records, all "|"-separated (no pipes inside fields):
     *   wish    name|target|query                      bill   name|amount|rule|who|autopay
     *   spend   date|amount|category|who|split|note     goal   name|target|saved|by (10.1.1)
     *   pantry  name|expires|qty|where|opened|low|unit  (10.4 added opened, low = keep at least this many, unit)
     *   pkg     name|carrier|tracking|expected                                                       */
    var REC = { wish: ["name", "target", "query"], bill: ["name", "amount", "rule", "who", "autopay"], spend: ["date", "amount", "cat", "who", "split", "note"],
                goal: ["name", "target", "saved", "by"], pantry: ["name", "expires", "qty", "where", "opened", "low", "unit"], pkg: ["name", "carrier", "tracking", "expected"],
                book: ["title", "author", "ext", "size", "want", "src", "added", "conv"] };      // 10.3: the book cloud (want = kindle | cloud)
    function parseRec(kind, text) {
        var f = String(text || "").split("|"), o = {}, ks = REC[kind] || [];
        for (var i = 0; i < ks.length; i++) o[ks[i]] = f[i] === undefined ? "" : f[i];
        ["target", "amount", "saved", "qty", "size", "low"].forEach(function(n) { if (o[n] !== undefined) o[n] = o[n] === "" ? 0 : +o[n] || 0; });
        ["date", "expires", "expected", "by", "added", "opened"].forEach(function(n) {          // 10.1.2: a broken date reads as "no date" (was "undefined NaN" on screen)
            if (o[n] && !(/^\d{4}-\d\d-\d\d$/.test(o[n]) && +o[n].substring(5, 7) >= 1 && +o[n].substring(5, 7) <= 12 && +o[n].substring(8, 10) >= 1 && +o[n].substring(8, 10) <= 31)) o[n] = "";
        });
        if (o.split !== undefined) o.split = o.split === "1";
        if (o.autopay !== undefined) o.autopay = o.autopay === "1";
        return o;
    }
    function recText(kind, o) {
        var ks = REC[kind] || [], out = [];
        for (var i = 0; i < ks.length; i++) {
            var v = o[ks[i]];
            if (v === true) v = "1";
            if (v === false || v === undefined || v === null || (kind === "pantry" && ks[i] === "low" && !(+v > 0))) v = "";      // 10.4: "keep at least 0" is the same as not set
            out.push(String(v).replace(/[|\t\n]/g, " "));
        }
        if (kind === "pantry") while (out.length > 4 && out[out.length - 1] === "") out.pop();      // 10.4: lines without the new fields look exactly like 10.3's
        return out.join("|");
    }
    function money2(x) { var s = (Math.round((+x || 0) * 100) / 100).toFixed(2), p = s.split("."); return (s.charAt(0) === "-" ? "-$" + p[0].substring(1) : "$" + p[0]).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + p[1]; }
    function payPeriod(shifts, k, cfg) { var p = periodOf(k, cfg), r = payFor(shifts, p.from, p.to, cfg); r.payday = p.payday; return r; }
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
    /* 9.8.5 repeating things (chores, garbage night, payday, birthdays):
     * kind "repeat", text "RULE|HH:MM|Title|Note"   RULE is one of
     *   daily | weekly:1,4 (0=Sun) | every2w:2:2026-11-17 (weekday + a date it falls on) |
     *   monthly:15 | monthly:last | yearly:11-17                                                 */
    function parseRepeat(text) {
        var f = String(text).split("|");
        if (f.length < 3 || !/^(daily|weekly:[0-6](,[0-6])*|every2w:[0-6]:\d{4}-\d\d-\d\d|monthly:(\d{1,2}|last)|yearly:\d\d-\d\d|months:\d{1,2}:\d{4}-\d\d-\d\d)$/.test(f[0])) return null;
        var who = f.length >= 5 && /^(p1|p2|all|rot)?$/.test(f[f.length - 1]) ? f.pop() : "";
        return { rule: f[0], time: /^\d\d:\d\d$/.test(f[1]) ? f[1] : "", title: f[2], note: f.slice(3).join("|"), who: who === "all" ? "" : who };
    }
    function repeatText(rule, time, title, note, who) { return rule + "|" + (time || "") + "|" + String(title).replace(/\|/g, "/") + "|" + String(note || "").replace(/\|/g, "/") + (who ? "|" + who : ""); }
    function dayNum(k) { return Math.round(Date.UTC(+k.substring(0, 4), +k.substring(5, 7) - 1, +k.substring(8, 10)) / 86400000); }
    function repeatOn(r, k) {      // does repeat r fall on day k (YYYY-MM-DD)?
        var p = r.rule.split(":"), d = new Date(dayNum(k) * 86400000), dow = d.getUTCDay(), dom = d.getUTCDate();
        if (p[0] === "daily") return true;
        if (p[0] === "weekly") return ("," + p[1] + ",").indexOf("," + dow + ",") >= 0;
        if (p[0] === "every2w") return dow === +p[1] && ((dayNum(k) - dayNum(p[2])) % 14 + 14) % 14 === 0;
        if (p[0] === "monthly") {
            if (p[1] === "last") return new Date((dayNum(k) + 1) * 86400000).getUTCDate() === 1;
            var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
            return dom === Math.min(+p[1], last);          // the 31st becomes the last day in short months
        }
        var mlast = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        if (p[0] === "yearly") return k.substring(5) === p[1] || (p[1] === "02-29" && mlast === 28 && k.substring(5) === "02-28");   // 10.1.1: Feb 29 -> Feb 28
        if (p[0] === "months") {          // 10.0: every N months from a start date (furnace filter, smoke alarms...)
            if (k < p[2] || dom !== Math.min(+p[2].substring(8, 10), mlast)) return false;      // 10.1.1: started on the 31st -> last day of short months
            var mm = (+k.substring(0, 4) - +p[2].substring(0, 4)) * 12 + (+k.substring(5, 7) - +p[2].substring(5, 7));
            return mm % (+p[1] || 1) === 0;
        }
        return false;
    }
    // 10.0: "rot" = a chore that alternates weekly between the two of you (week of the year decides)
    function rotWho(k) { var wk = Math.floor((dayNum(k) + 4) / 7); return wk % 2 === 0 ? "p1" : "p2"; }
    function ruleLabel(rule) {
        var D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], p = rule.split(":");
        if (p[0] === "daily") return "every day";
        if (p[0] === "weekly") return "every " + p[1].split(",").map(function(x) { return D[+x]; }).join(", ");
        if (p[0] === "every2w") return "every 2nd " + D[+p[1]];
        if (p[0] === "monthly") return p[1] === "last" ? "last day of the month" : "monthly on the " + p[1];
        if (p[0] === "yearly") { var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return "every year on " + (MO[+String(p[1]).substring(0, 2) - 1] || "") + " " + (+String(p[1]).substring(3, 5) || ""); }
        if (p[0] === "months") return "every " + p[1] + " months";
        return rule;
    }
    // items: [{id, text}] of kind "repeat" (already unlocked) -> {date: [{id, time, title, note, rep}]}
    function expandRepeats(items, fromKey, days) {
        var out = {}, rs = [], i, j;
        for (i = 0; i < items.length; i++) { var r = parseRepeat(items[i].text); if (r) { r.id = items[i].id; rs.push(r); } }
        if (!rs.length) return out;
        var n0 = dayNum(fromKey);
        for (j = 0; j < days; j++) {
            var d = new Date((n0 + j) * 86400000), k = key(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            for (i = 0; i < rs.length; i++) if (repeatOn(rs[i], k)) (out[k] = out[k] || []).push({ id: rs[i].id, date: k, time: rs[i].time, title: rs[i].title, note: rs[i].note, rep: rs[i].rule, who: rs[i].who === "rot" ? rotWho(k) : rs[i].who, rot: rs[i].who === "rot" });
        }
        return out;
    }
    return { key: key, shiftId: shiftId, parseShift: parseShift, parseEvent: parseEvent, eventText: eventText, fmtTime: fmtTime, holidays: holidays, holiday: holiday,
             parseRepeat: parseRepeat, repeatText: repeatText, repeatOn: repeatOn, ruleLabel: ruleLabel, expandRepeats: expandRepeats,
             shiftIdFor: shiftIdFor, whoOfShift: whoOfShift, parseShop: parseShop, shopText: shopText, shiftSpan: shiftSpan,
             periodOf: periodOf, payFor: payFor, payPeriod: payPeriod, rotWho: rotWho, dayNum: dayNum, keyN: keyN,
             parseRec: parseRec, recText: recText, money: money2 };
})();

/* ---------------- HubPantry (10.4): the pantry rules every device shares ----------------
 * Settings live in the list as cfg item "pantry" (JSON):
 *   { locs: ["Fridge", "Freezer", "Pantry"],          where food can be (up to 8)
 *     days: { Fridge: 5, Freezer: 90, Pantry: 60 },   shelf life when nothing better is known
 *     on: { board, tile, remind, fromList, restock, cook } }   each feature on (1) or off (0)
 * Pantry items: HubCal "pantry" records (name|expires|qty|where|opened|low|unit).
 *   low = keep at least this many: when qty drops below it (or the item is used up) it goes on the list.  */
var HubPantry = (function() {
    var FEATURES = ["board", "tile", "remind", "fromList", "restock", "cook"];
    var DEF = { locs: ["Fridge", "Freezer", "Pantry"], days: { Fridge: 5, Freezer: 90, Pantry: 60 } };
    // [what it matches, days unopened, where it usually lives, days once opened (0 = no change)]
    var SHELF = [
        [/ice cream|frozen|freezer/, 180, "Freezer", 0],
        [/leftover/, 3, "Fridge", 0],
        [/\bmilk\b|cream\b|half and half/, 10, "Fridge", 7],
        [/yogh?urt|kefir|sour cream|cottage/, 14, "Fridge", 5],
        [/cheese/, 30, "Fridge", 21],
        [/butter|margarine/, 60, "Fridge", 30],
        [/\beggs?\b/, 28, "Fridge", 0],
        [/chicken|turkey|pork|beef|steak|ground|mince|sausage|fish|salmon|cod|tilapia|shrimp|prawn|lamb/, 2, "Fridge", 0],
        [/\bdeli\b|\bham\b|bacon|salami|hot dog|wiener/, 7, "Fridge", 4],
        [/juice/, 10, "Fridge", 7],
        [/lettuce|greens|spinach|salad|kale|arugula|herb|cilantro|parsley|basil/, 5, "Fridge", 0],
        [/berr|grape/, 5, "Fridge", 0],
        [/mushroom/, 5, "Fridge", 0],
        [/carrot|celery|pepper|cucumber|broccoli|cauliflower|zucchini|cabbage/, 10, "Fridge", 0],
        [/apple|orange|lemon|lime|pear/, 21, "Fridge", 0],
        [/banana|avocado|tomato/, 5, "Pantry", 0],
        [/potato|onion|garlic|squash/, 30, "Pantry", 0],
        [/bread|\bbuns?\b|bagel|tortilla|wrap|pita|muffin/, 6, "Pantry", 0],
        [/salsa|pesto|hummus|dip/, 14, "Fridge", 7],
        [/ketchup|mustard|mayo|jam|sauce|dressing/, 180, "Pantry", 60],
        [/rice|pasta|noodle|flour|sugar|cereal|oat|bean|lentil|can|soup|broth|oil|coffee|tea|spice|salt|honey|peanut/, 365, "Pantry", 0]
    ];
    var NOT_FOOD = /paper|towel|toilet|tissue|soap|detergent|laundry|dish ?wash|garbage|bags?\b|foil|wrap film|cleaner|bleach|sponge|batter(y|ies)|shampoo|conditioner|toothpaste|razor|diaper|wipes|deodorant|lotion|light ?bulb|cat litter|dog food/;

    function cfg(text) {
        var o = {}; try { o = text ? JSON.parse(text) : {}; } catch (e) { o = {}; }
        if (!o || typeof o !== "object") o = {};
        var locs = [], i;
        if (Array.isArray(o.locs)) for (i = 0; i < o.locs.length && locs.length < 8; i++) { var l = String(o.locs[i] || "").replace(/[|\t\n]/g, " ").replace(/^\s+|\s+$/g, "").substring(0, 20); if (l && locs.indexOf(l) < 0) locs.push(l); }
        if (!locs.length) locs = DEF.locs.slice();
        var days = {};
        for (i = 0; i < locs.length; i++) { var d = o.days && +o.days[locs[i]]; days[locs[i]] = d >= 1 && d <= 730 ? Math.round(d) : (DEF.days[locs[i]] || 7); }
        var on = {};
        for (i = 0; i < FEATURES.length; i++) on[FEATURES[i]] = !(o.on && (o.on[FEATURES[i]] === 0 || o.on[FEATURES[i]] === false));
        return { locs: locs, days: days, on: on };
    }
    function cfgText(c) {
        var on = {}; for (var i = 0; i < FEATURES.length; i++) on[FEATURES[i]] = c.on[FEATURES[i]] ? 1 : 0;
        return JSON.stringify({ locs: c.locs, days: c.days, on: on });
    }
    // best guess for something new: how long it keeps, where it goes, how long once opened
    function guess(name, c) {
        c = c || cfg(null);
        var n = String(name || "").toLowerCase();
        for (var i = 0; i < SHELF.length; i++) if (SHELF[i][0].test(n)) {
            var w = c.locs.indexOf(SHELF[i][2]) >= 0 ? SHELF[i][2] : c.locs[0];
            return { days: SHELF[i][1], where: w, open: SHELF[i][3] };
        }
        return { days: c.days[c.locs[0]] || 7, where: c.locs[0], open: 0 };
    }
    function isFood(name) { return !NOT_FOOD.test(String(name || "").toLowerCase()); }
    function daysLeft(p, today) { return p && p.expires ? HubCal.dayNum(p.expires) - HubCal.dayNum(today) : null; }
    // expired | today | soon (1-2 days) | week (3-7) | ok | none (no date)
    function status(p, today) {
        var d = daysLeft(p, today);
        return d === null ? "none" : d < 0 ? "expired" : d === 0 ? "today" : d <= 2 ? "soon" : d <= 7 ? "week" : "ok";
    }
    // opening something can shorten how long it keeps (milk: 7 days once open)
    function opened(p, today, c) {
        var g = guess(p.name, c), o = {}, k;
        for (k in p) if (p.hasOwnProperty(k)) o[k] = p[k];
        o.opened = today;
        if (g.open > 0) { var lim = HubCal.keyN(HubCal.dayNum(today) + g.open); if (!o.expires || o.expires > lim) o.expires = lim; }
        return o;
    }
    function sameName(a, b) { var f = function(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/s\b/g, "").replace(/\s+/g, " ").replace(/^\s|\s$/g, ""); }; return f(a) === f(b) && f(a) !== ""; }
    function needsRestock(p) { return p.low > 0 && (+p.qty || 0) < p.low; }
    // which of your places an item is in: the fridge saved "fridge" before 10.4, the phone "Fridge"; unknown -> first place
    function place(where, c) {
        c = c || cfg(null);
        var w = String(where || "").toLowerCase();
        for (var i = 0; i < c.locs.length; i++) if (c.locs[i].toLowerCase() === w) return c.locs[i];
        return w ? String(where) : c.locs[0];
    }
    return { FEATURES: FEATURES, cfg: cfg, cfgText: cfgText, guess: guess, isFood: isFood, daysLeft: daysLeft, status: status, opened: opened, sameName: sameName, needsRestock: needsRestock, place: place };
})();
if (typeof module !== "undefined") { module.exports.HubCrypt = HubCrypt; module.exports.HubCal = HubCal; module.exports.HubPantry = HubPantry; }
