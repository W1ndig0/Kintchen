// 10.7 one-off live check, run on GitHub (this workspace can't reach these sites). Prints public data only.
const path = require("path");
const { HubCal } = require(path.join(__dirname, "../../cloud/hubdata.js"));
const week = require(path.join(__dirname, "../../cloud/week.js"));
const ent = s => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function get(url, ms, opts) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 15000);
    try { const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 KitchenHub" }, ...(opts || {}) }); if (!r.ok) console.log("  HTTP " + r.status + " " + url.slice(0, 90)); return r.ok ? await r.text() : null; }
    catch (e) { console.log("  ERR " + e.name + " " + url.slice(0, 90)); return null; } finally { clearTimeout(t); }
}
(async () => {
    // the same helpers extras.js uses
    const crypto = require("crypto");
    const onSale = p => { const s = +p.salePrice, r = +p.regularPrice; return !p.isMarketplace && s > 0 && r > 0 && s < r - 0.5; };
    const bbDeal = p => { const price = +p.salePrice || +p.regularPrice || 0, reg = +p.regularPrice || price; return { sku: String(p.sku || ""), title: String(p.name || "").slice(0, 60), price, reg, off: reg > price ? Math.round((1 - price / reg) * 100) : 0, img: p.thumbnailImage ? "img/d" + crypto.createHash("md5").update(String(p.thumbnailImage)).digest("hex").slice(0, 12) + ".jpg" : "", src: String(p.thumbnailImage || "").slice(0, 70) }; };
    const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
    const addK = (k, n) => new Date(Date.parse(k + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
    const t0 = Date.now();
    const w = await week({ get, TODAY: today, addK, log: console.log, decodeEnts: ent, bbDeal, onSale });
    console.log("== big this week (" + w.from + " .. " + w.to + "), " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
    for (const e of w.events) {
        console.log(`${e.date} ${e.kind.padEnd(4)} [${e.rank}] ${e.t}`);
        (e.news || []).forEach(n => console.log("     news: " + n.t.slice(0, 90) + " (" + n.src + ")"));
        (e.deals || []).forEach(d => console.log("     deal: " + d.title + " $" + d.price + (d.off ? " (-" + d.off + "% of $" + d.reg + ")" : "") + " " + (d.src ? "photo ok" : "NO PHOTO")));
    }
    console.log("== Best Buy fields check (skipped)"); return;
    for (const q of ["nintendo switch 2", "sony headphones"]) {
        const t = await get("https://www.bestbuy.ca/api/v2/json/search?query=" + encodeURIComponent(q) + "&lang=en-CA&pageSize=12&sortBy=relevance", 15000, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KitchenHub", Accept: "application/json" } });
        let j = null; try { j = JSON.parse(t); } catch (e) {}
        const ps = (j && j.products) || [];
        console.log(q + ": " + ps.length + " products, on sale " + ps.filter(onSale).length + ", fields: " + (ps[0] ? Object.keys(ps[0]).join(",") : "-"));
        ps.slice(0, 3).forEach(p => console.log("   " + bbDeal(p).title + " $" + p.salePrice + " reg $" + p.regularPrice + " cat=" + (p.categoryName || "") + " img=" + String(p.thumbnailImage || "").slice(0, 60)));
    }
})();
