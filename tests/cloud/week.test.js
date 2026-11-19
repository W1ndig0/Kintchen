// 10.7: the "big this week" module with canned Wikidata / Google News / Best Buy answers. node tests/cloud/week.test.js
const week = require("../../cloud/week.js");
const fail = m => { console.log("FAIL " + m); process.exitCode = 1; };
const b = (id, l, d, n) => ({ i: { value: "http://www.wikidata.org/entity/" + id }, l: { value: l }, d: { value: d + "T00:00:00Z" }, n: { value: String(n) } });
const now = new Date().toUTCString();
const rss = t => "<rss><channel>" + [1, 2, 3, 4].map(k => `<item><title>${t} headline ${k} &amp; more - Paper ${k}</title><source url="x">Paper ${k}</source><pubDate>${now}</pubDate></item>`).join("") + "</channel></rss>";
const P = (sku, name, cat, sale, reg, extra) => Object.assign({ sku, name, categoryName: cat, salePrice: sale, regularPrice: reg, thumbnailImage: "https://img/" + sku + ".jpg" }, extra || {});
const BB = {
    "Grand Theft Auto VI": [P(1, "Grand Theft Auto VI (PS5)", "PS5 Games", 109.99, 109.99), P(2, "Rainbow Six Siege (PS5)", "PS5 Games", 19.97, 28.97),
                            P(3, "Custom DualSense Controller", "PS5 Controllers", 149.99, 299.99, { isMarketplace: true }), P(4, "Nothing Phone (3)", "Unlocked Phones", 699, 1079)],
    "I Play Rocky": [P(5, "ROCKY MOUNTAIN Play Set", "Toys", 60, 60), P(6, "Phone case", "Cases", 10, 20)]
};
let calls = 0;
async function get(url) {
    calls++;
    if (url.includes("wikidata")) {
        const q = decodeURIComponent(url);
        if (q.includes("Q7889")) return JSON.stringify({ results: { bindings: [b("Q1", "Grand Theft Auto VI", "2026-11-19", 72)] } });
        if (q.includes("Q11424")) return JSON.stringify({ results: { bindings: [b("Q2", "I Play Rocky", "2026-11-20", 20), b("Q3", "Old Film", "2026-10-01", 99)] } });
        if (q.includes("Q5398426")) return null;                  // a query that times out
        return JSON.stringify({ results: { bindings: [] } });
    }
    if (url.includes("news.google")) { const t = /q=%22(.*?)%22/.exec(url); return rss(decodeURIComponent(t[1])); }
    if (url.includes("bestbuy")) { const q = decodeURIComponent(/query=([^&]*)/.exec(url)[1]); return JSON.stringify({ products: BB[q] || [] }); }
    return null;
}
const onSale = p => { const s = +p.salePrice, r = +p.regularPrice; return !p.isMarketplace && s > 0 && r > 0 && s < r - 0.5; };
const bbDeal = p => ({ sku: String(p.sku), title: p.name, price: +p.salePrice, reg: +p.regularPrice, off: Math.round((1 - p.salePrice / p.regularPrice) * 100), img: "img/d" + String(p.sku).padStart(12, "0") + ".jpg" });
const addK = (k, n) => new Date(Date.parse(k + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
(async () => {
    const w = await week({ get, TODAY: "2026-11-19", addK, log: () => {}, decodeEnts: s => s.replace(/&amp;/g, "&"), bbDeal, onSale });
    const t = w.events.map(e => e.t);
    if (t.join("|") !== "Grand Theft Auto VI|I Play Rocky") fail("events " + t.join("|")); else console.log("PASS events: biggest first, out-of-window film dropped, timed-out query skipped");
    const g = w.events[0];
    if (g.news.length !== 3 || g.news[0].t !== "Grand Theft Auto VI headline 1 & more" || g.news[0].src !== "Paper 1") fail("news " + JSON.stringify(g.news[0])); else console.log("PASS news: 3 headlines, source split off, entities decoded");
    const dt = g.deals.map(d => d.title);
    if (dt.join("|") !== "Grand Theft Auto VI (PS5)|Rainbow Six Siege (PS5)" || g.deals[1].also !== "PS5 Games") fail("game deals " + dt.join("|")); else console.log("PASS game deals: the release + same-department sale; no marketplace fake sale, no phone");
    if (w.events[1].deals.length) fail("film deals " + JSON.stringify(w.events[1].deals)); else console.log("PASS film deals: a toy set that shares the title words is not the film");
})();
