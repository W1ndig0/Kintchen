// 10.7: the Deals page gets at least five deals from the wishlist (fake Best Buy answers, no network)
const path = require("path"), assert = require("assert");
const { HubCal } = require(path.join(__dirname, "../../cloud/hubdata.js"));
const extras = require(path.join(__dirname, "../../cloud/extras.js"));
const P = (sku, name, sale, reg, cat) => ({ sku, name, salePrice: sale, regularPrice: reg, thumbnailImage: "https://multimedia.bbycastatic.ca/x/" + sku + ".jpg", productUrl: "/en-ca/product/" + sku, categoryName: cat || "" });
const BB = {
    "sony headphones": [P(1, "Sony WH-1000XM5", 349.99, 449.99, "Headphones"), P(2, "Sony WH-CH720N", 129.99, 199.99), P(3, "Sony WF-1000XM5", 299.99, 299.99)],
    "nintendo switch 2": [P(10, "Nintendo Switch 2", 629.99, 629.99, "Consoles"), P(11, "Switch 2 Pro Controller", 89.99, 109.99), P(12, "Mario Kart World", 79.99, 99.99), P(13, "Switch 2 case", 24.99, 34.99)],
    "kobo libra": [P(20, "Kobo Libra Colour", 299.99, 299.99, "eReaders")],
    "eReaders": [P(21, "Kobo Clara BW", 139.99, 169.99), P(22, "Kindle Paperwhite", 179.99, 219.99), P(20, "Kobo Libra Colour", 299.99, 299.99)]
};
const wishes = [["w1", "Sony headphones|300|sony headphones"], ["w2", "Switch 2||nintendo switch 2"], ["w3", "Kobo Libra||kobo libra"]];
const get = async (u) => {
    const m = /bestbuy\.ca\/api\/v2\/json\/search\?query=([^&]+)/.exec(u);
    if (!m) return null;
    return JSON.stringify({ products: BB[decodeURIComponent(m[1])] || [] });
};
(async () => {
    const pushed = [];
    const ctx = { items: k => k === "wish" ? wishes.map(([id, text]) => ({ id, text, state: "open" })) : [], push: async (t) => pushed.push(t), sent: () => false, mark: () => {},
        NOW: Date.parse("2026-11-19T20:00:00Z"), TODAY: "2026-11-19", TOMORROW: "2026-11-20", HOUR: 13, DOW: 4, addK: (k, n) => k, get, HubCal,
        decodeEnts: s => s, log: () => {}, state: {}, pantryCfg: { on: {} } };
    const out = await extras(ctx);
    const d = out.deals;
    console.log(d.map(x => `${x.kind.padEnd(7)} ${x.title.padEnd(26)} $${x.price} (reg $${x.reg}, -${x.off}%) for ${x.for} ${x.img}`).join("\n"));
    assert(d.length >= 5, "at least five deals, got " + d.length);
    assert.strictEqual(d[0].kind, "wish", "the wishlist item on sale comes first");
    assert(d.every(x => x.price < x.reg && x.off > 0), "every deal is a real sale");
    assert(d.every(x => /^img\/d[0-9a-f]{12}\.jpg$/.test(x.img) && /^https:\/\//.test(x.src)), "every deal has a photo path and source");
    assert.strictEqual(new Set(d.map(x => x.sku)).size, d.length, "no duplicates");
    assert(!d.some(x => x.sku === "20"), "a full-price item is not a deal");
    console.log("PASS deals: " + d.length + " (wish + similar + broader fill)");
})().catch(e => { console.error("FAIL " + e.message); process.exit(1); });
(async () => {
    const one = [["w3", "Kobo Libra||kobo libra"]];
    const ctx = { items: k => k === "wish" ? one.map(([id, text]) => ({ id, text, state: "open" })) : [], push: async () => {}, sent: () => false, mark: () => {},
        NOW: Date.parse("2026-11-19T20:00:00Z"), TODAY: "2026-11-19", TOMORROW: "2026-11-20", HOUR: 13, DOW: 4, addK: (k) => k, get, HubCal, decodeEnts: s => s, log: () => {}, state: {}, pantryCfg: { on: {} } };
    const d = (await extras(ctx)).deals;
    assert(d.length === 2 && d.every(x => x.kind === "similar" && x.for === "Kobo Libra"), "category fill: " + JSON.stringify(d.map(x => x.title)));
    console.log("PASS fill: nothing on sale in the wishlist -> " + d.map(x => x.title).join(", ") + " (same category)");
})().catch(e => { console.error("FAIL " + e.message); process.exit(1); });
