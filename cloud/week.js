/* Kitchen Hub 10.7: "big this week" for the Almanac.
 * Games, films and TV seasons released in the next week (from Wikidata, ranked by how many language
 * Wikipedias cover them - a good measure of "big"), each with a few related headlines (Google News) and
 * related deals (Best Buy). Runs inside extras.js; the result rides in the locked extra.js as EX.week.
 * Prints counts only (public logs).                                                                     */
"use strict";
const KINDS = [["game", "Q7889", 8], ["film", "Q11424", 12], ["tv", "Q3464665", 8], ["tv", "Q5398426", 10]];
function sparql(cls, from, to, minLinks) {
    return "SELECT ?i ?l ?d ?n WHERE { ?i wdt:P31 wd:" + cls + " ; (p:P577|p:P580) ?s . ?s (psv:P577|psv:P580) ?v . " +
        "?v wikibase:timePrecision 11 ; wikibase:timeValue ?d . " +
        "FILTER(?d >= \"" + from + "T00:00:00Z\"^^xsd:dateTime && ?d < \"" + to + "T00:00:00Z\"^^xsd:dateTime) " +
        "?i wikibase:sitelinks ?n . FILTER(?n >= " + minLinks + ") ?i rdfs:label ?l . FILTER(lang(?l) = \"en\") } ORDER BY DESC(?n) LIMIT 12";
}
function words(t) { return String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !/^(the|and|season|part|for)$/.test(w)); }
module.exports = async function week(ctx) {
    const { get, TODAY, addK, log, decodeEnts, bbDeal, onSale } = ctx;
    const from = addK(TODAY, -1), to = addK(TODAY, 8);
    const UA = { headers: { "User-Agent": "KitchenHub/10.7 (https://github.com/W1ndig0/Kintchen; kitchen display)", Accept: "application/sparql-results+json" } };
    const found = {};
    for (const [kind, cls, minLinks] of KINDS) {
        const u = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql(cls, from, to, minLinks));
        let t = await get(u, 30000, UA);
        if (!t) { log("week: " + kind + " " + cls + " query slow, trying once more"); t = await get(u, 55000, UA); }
        let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        const rows = j && j.results && Array.isArray(j.results.bindings) ? j.results.bindings : [];
        for (const r of rows) {
            const id = r.i && r.i.value, d = r.d && String(r.d.value).slice(0, 10), n = +(r.n && r.n.value) || 0, l = r.l && r.l.value;
            if (!id || !l || !/^\d{4}-\d\d-\d\d$/.test(d)) continue;
            if (!found[id] || found[id].date > d) found[id] = { t: String(l).slice(0, 80), kind, date: d, rank: n };
        }
    }
    const events = Object.keys(found).map(k => found[k]).sort((a, b) => b.rank - a.rank).slice(0, 6);
    log("week: " + events.length + " big releases");
    const J = async (u) => { const t = await get(u, 15000, { headers: { "User-Agent": "Mozilla/5.0 KitchenHub", Accept: "application/json" } }); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    for (const e of events.slice(0, 4)) {
        // related headlines: Google News search for the exact title (Canada, English)
        e.news = [];
        const rss = await get("https://news.google.com/rss/search?q=" + encodeURIComponent("\"" + e.t + "\" " + ({ game: "game", film: "film", tv: "series" }[e.kind] || "")) + "&hl=en-CA&gl=CA&ceid=CA:en", 15000, { headers: { "User-Agent": "Mozilla/5.0 KitchenHub" } });
        const items = String(rss || "").split("<item>").slice(1);
        for (const it of items) {
            const g = re => { const m = re.exec(it); return m ? decodeEnts(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : ""; };
            let title = g(/<title>([\s\S]*?)<\/title>/), src = g(/<source[^>]*>([\s\S]*?)<\/source>/), when = Date.parse(g(/<pubDate>([\s\S]*?)<\/pubDate>/));
            if (src && title.endsWith(" - " + src)) title = title.slice(0, -(src.length + 3));
            if (!title || (when && Date.now() - when > 14 * 86400000)) continue;
            e.news.push({ t: title.slice(0, 140), src: src.slice(0, 40), at: when ? Math.floor(when / 1000) : 0 });
            if (e.news.length >= 3) break;
        }
        // related deals: games and films at Best Buy (the release itself, then things on sale that go with it)
        e.deals = [];
        if (e.kind === "game" || e.kind === "film") {
            const j = await J("https://www.bestbuy.ca/api/v2/json/search?query=" + encodeURIComponent(e.t) + "&lang=en-CA&pageSize=12&sortBy=relevance");
            const ps = j && Array.isArray(j.products) ? j.products.filter(p => p.isVisible !== false && (+p.salePrice || +p.regularPrice) > 0) : [];
            const w = words(e.t), match = p => w.length && w.every(x => String(p.name || "").toLowerCase().indexOf(x) >= 0);
            // the release itself only counts in a game or movie department (a search for "I Play Rocky" also finds toy cameras),
            // and "goes with it" means on sale in the same department (other PS5 games), never whatever else the search turned up
            const media = p => /game|movie|blu-?ray|dvd|4k|film/i.test(String(p.categoryName || "")), ownP = ps.filter(p => match(p) && media(p)).slice(0, 2);
            const cats = ownP.map(p => String(p.categoryName || "")).filter(Boolean);
            const sale = ps.filter(p => !match(p) && onSale(p) && cats.indexOf(String(p.categoryName || "")) >= 0).map(bbDeal).sort((a, b) => b.off - a.off).slice(0, 2);
            e.deals = ownP.map(bbDeal).concat(sale).slice(0, 3);
        }
    }
    return { at: Math.floor(Date.now() / 1000), from, to, events };
};
module.exports.sparql = sparql;
