/* Kitchen Hub v11 - price check: which ONE store is cheapest for the whole shopping list.
 * Stores: Costco, Real Canadian Superstore, Walmart, Save-On-Foods (Prince George).
 *   prices come from (1) your price book (what you typed in - the only source for most Costco prices, which aren't
 *   published), then (2) Flipp: the stores' current flyers, plus Walmart's everyday online prices.
 *   For each item and store the best-matching product is picked; you can change a pick and it is remembered.
 *   A store without a price for an item counts it as missing - never as $0.
 *   Ranking: fewest missing items first, then the lowest total. Each store shows its total, what it is missing,
 *   and how much more it costs than the cheapest.
 * Flipp is an unofficial interface: if it changes or stops answering, the price book still works. */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { atomicWrite } = require("./store.js");

const STORES = [
    { id: "costco", name: "Costco", re: /costco/i },
    { id: "superstore", name: "Superstore", re: /real canadian superstore|^superstore/i },
    { id: "walmart", name: "Walmart", re: /walmart/i },
    { id: "saveon", name: "Save-On-Foods", re: /save-?on-?foods/i }
];
const STOP = { the: 1, a: 1, of: 1, and: 1, with: 1, for: 1, fresh: 1, pc: 1, great: 1, value: 1, kirkland: 1, signature: 1, no: 1, name: 1, brand: 1 };

const norm = (s) => String(s || "").toLowerCase().replace(/[®™©]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter(w => w && !STOP[w]).map(w => w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.replace(/(ies)$/, "y").replace(/s$/, "") : w);
// how well a product name matches a list item: share of the item's words found in the product (0..1)
function match(item, product) {
    const iw = words(item), pw = {}; words(product).forEach(w => { pw[w] = 1; });
    if (!iw.length) return 0;
    let hit = 0; iw.forEach(w => { if (pw[w] || Object.keys(pw).some(p => p.length > 3 && w.length > 3 && (p.startsWith(w) || w.startsWith(p)))) hit++; });
    return hit / iw.length;
}
// "Milk 4 L", "12 x 355 mL", "1.5kg", "454 g" -> { amount, unit: "g" | "ml" | "each" } or null
function sizeOf(name) {
    const s = String(name || "").toLowerCase().replace(/,/g, ".");
    let m = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lb|oz)\b/.exec(s), k = 1;
    if (m) { k = +m[1]; m = [m[0], m[2], m[3]]; } else m = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lb|oz)\b/.exec(s);
    if (!m) { const c = /(\d+)\s*(?:pack|pk|count|ct|pcs)\b/.exec(s); return c ? { amount: +c[1], unit: "each" } : null; }
    const v = +m[1] * k, u = m[2];
    if (u === "kg") return { amount: v * 1000, unit: "g" };
    if (u === "g") return { amount: v, unit: "g" };
    if (u === "lb") return { amount: v * 453.6, unit: "g" };
    if (u === "oz") return { amount: v * 28.35, unit: "g" };
    if (u === "l") return { amount: v * 1000, unit: "ml" };
    return { amount: v, unit: "ml" };
}
function unitPrice(price, name) {
    const z = sizeOf(name); if (!z || !z.amount) return null;
    return z.unit === "each" ? { per: "each", value: price / z.amount } : { per: z.unit === "g" ? "100 g" : "100 mL", value: price / z.amount * 100 };
}

// Flipp search answer -> [{ store, name, price, kind: flyer|online, story, until }]
function parseFlipp(text) {
    let j; try { j = JSON.parse(text); } catch (e) { return []; }
    if (!j || typeof j !== "object") return [];
    const out = [];
    (j.items || []).forEach(i => {
        const st = STORES.find(s => s.re.test(i.merchant_name || ""));
        if (st && typeof i.current_price === "number" && i.current_price > 0) out.push({ store: st.id, name: String(i.name || ""), price: i.current_price, kind: "flyer", story: i.sale_story || "", until: i.valid_to || "" });
    });
    (j.ecom_items || []).forEach(i => {
        const st = STORES.find(s => s.re.test(i.merchant || ""));
        if (st && typeof i.current_price === "number" && i.current_price > 0) out.push({ store: st.id, name: String(i.name || ""), price: i.current_price, kind: "online", story: "", until: "" });
    });
    return out;
}

// best first: closest name match, then the cheapest per 100 g / 100 mL / each (so a 310 mL bottle doesn't beat 4 L
// just for being cheaper), then the lowest price
function rank(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (a.unit && b.unit && a.unit.per === b.unit.per) return a.unit.value - b.unit.value;
    if (a.unit && !b.unit) return -1; if (b.unit && !a.unit) return 1;
    return a.price - b.price;
}
class Prices {
    constructor(opts) {
        this.dir = opts.dataDir; this.log = opts.log || (() => {});
        this.get = opts.get || (async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }); return r.ok ? await r.text() : null; } catch (e) { return null; } });
        this.postal = String(opts.postal || "V2L5M1").replace(/\s/g, "").toUpperCase();
        this.file = path.join(this.dir, "prices.json"); this.lastFile = path.join(this.dir, "pricecheck.json");
        try { this.db = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { this.db = null; }
        if (!this.db || typeof this.db !== "object") this.db = {};
        this.db.book = Array.isArray(this.db.book) ? this.db.book : [];
        this.db.picks = this.db.picks && typeof this.db.picks === "object" ? this.db.picks : {};
        this.running = null;
    }
    save() { atomicWrite(this.file, JSON.stringify(this.db, null, 1)); }
    last() { try { return JSON.parse(fs.readFileSync(this.lastFile, "utf8")); } catch (e) { return null; } }

    // ---- the price book (your own prices) ----
    addBook(e, now) {
        const store = STORES.find(s => s.id === e.store), price = Number(e.price);
        if (!store || !norm(e.item) || !(price > 0 && price < 10000)) return null;
        const x = { id: "p" + crypto.randomBytes(5).toString("hex"), store: store.id, item: String(e.item).slice(0, 80), product: String(e.product || e.item).slice(0, 120),
                    price: Math.round(price * 100) / 100, added: new Date(now || Date.now()).toISOString().slice(0, 10) };
        this.db.book.push(x); this.save(); return x;
    }
    delBook(id) { const n = this.db.book.length; this.db.book = this.db.book.filter(x => x.id !== id); this.save(); return this.db.book.length < n; }
    exportCsv() {
        const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
        return "store,item,product,price,added\n" + this.db.book.map(x => [x.store, q(x.item), q(x.product), x.price.toFixed(2), x.added].join(",")).join("\n") + "\n";
    }
    importCsv(text, now) {
        let n = 0;
        String(text).replace(/\r/g, "").split("\n").slice(1).forEach(l => {
            const f = []; let cur = "", inq = false;
            for (let i = 0; i < l.length; i++) { const c = l[i]; if (inq) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inq = false; else cur += c; } else if (c === '"') inq = true; else if (c === ",") { f.push(cur); cur = ""; } else cur += c; }
            f.push(cur);
            if (f.length >= 4) {
                const st = STORES.find(s => s.id === f[0].trim().toLowerCase() || s.re.test(f[0]));
                if (st && this.addBookQuiet({ store: st.id, item: f[1], product: f[2], price: f[3] }, now)) n++;
            }
        });
        this.save(); return n;
    }
    addBookQuiet(e, now) { const s = this.save; this.save = () => {}; try { return this.addBook(e, now); } finally { this.save = s; } }

    // ---- picks: "item|store" -> { name, price } (a product you chose) or { none: 1 } (not sold there) ----
    pick(item, store, choice) {
        const k = norm(item) + "|" + store;
        if (choice === null || choice === undefined) delete this.db.picks[k]; else this.db.picks[k] = choice;
        this.save();
    }

    async candidates(item) {
        const out = [];
        this.db.book.filter(x => norm(x.item) === norm(item.name) || match(item.name, x.item) >= 0.99)
            .forEach(x => out.push({ store: x.store, name: x.product, price: x.price, kind: "price book", added: x.added, score: 2 }));
        const t = await this.get("https://backflipp.wishabi.com/flipp/items/search?locale=en-ca&postal_code=" + encodeURIComponent(this.postal) + "&q=" + encodeURIComponent(norm(item.name)));
        parseFlipp(t).forEach(c => { const s = match(item.name, c.name); if (s >= 0.5) { c.score = s; out.push(c); } });
        out.forEach(c => { c.unit = unitPrice(c.price, c.name); });
        return out;
    }
    // items: [{ name, qty }] -> result
    async check(items, now) {
        if (this.running) return this.running;
        this.running = (async () => {
            now = now || Date.now();
            const rows = [];
            for (const it of items) {
                const cands = await this.candidates(it), row = { name: it.name, qty: it.qty || 1, stores: {} };
                for (const st of STORES) {
                    const k = norm(it.name) + "|" + st.id, p = this.db.picks[k], mine = cands.filter(c => c.store === st.id);
                    let chosen = null;
                    if (p && p.none) chosen = null;
                    else if (p && p.name) chosen = mine.find(c => c.name === p.name) || { store: st.id, name: p.name, price: p.price, kind: "your pick (last price)", unit: unitPrice(p.price, p.name) };
                    else if (mine.length) chosen = mine.slice().sort(rank)[0];
                    row.stores[st.id] = { pick: chosen, picked: !!p, options: mine.slice().sort(rank).slice(0, 8) };
                }
                rows.push(row);
            }
            const totals = STORES.map(st => {
                let total = 0; const missing = [];
                rows.forEach(r => { const c = r.stores[st.id].pick; if (c) total += c.price * r.qty; else missing.push(r.name); });
                return { store: st.id, name: st.name, total: Math.round(total * 100) / 100, missing };
            }).sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);
            const best = totals[0];
            // savings are compared on the items BOTH stores have, so a store missing things never looks cheaper than it is
            totals.forEach(t => {
                if (t === best) { t.more = 0; t.common = rows.length - t.missing.length; return; }
                let a = 0, b = 0, n = 0;
                rows.forEach(r => { const x = r.stores[t.store].pick, y = r.stores[best.store].pick; if (x && y) { a += x.price * r.qty; b += y.price * r.qty; n++; } });
                t.more = Math.round((a - b) * 100) / 100; t.common = n;
            });
            const res = { at: now, items: rows, totals, best: best && best.name,
                          summary: best ? "Cheapest: " + best.name + " $" + best.total.toFixed(2) + (best.missing.length ? " (missing " + best.missing.length + ")" : "") +
                                          totals.slice(1).map(t => ". " + t.name + " $" + t.total.toFixed(2) + (t.missing.length ? " (missing " + t.missing.length + ")" : "")).join("") : "" };
            atomicWrite(this.lastFile, JSON.stringify(res));
            this.log("price check: " + items.length + " items, " + res.summary);
            return res;
        })();
        try { return await this.running; } finally { this.running = null; }
    }
}
module.exports = { Prices, STORES, match, sizeOf, unitPrice, parseFlipp, norm };
