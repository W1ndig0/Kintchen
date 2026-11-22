// Kitchen Hub v11: the Node package builder (cloud/package.js) makes the same package as sync_data.sh.
// Both run against the same canned web (a fake curl for the shell, a fake get for Node); the results are compared.
// node tests/pc/package.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const P = require(ROOT + "/cloud/package.js");
let pass = 0, fail = 0;
async function t(n, f) { try { await f(); pass++; console.log("PASS " + n); } catch (e) { fail++; console.log("FAIL " + n + ": " + (e && e.stack || e)); } }

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]);
const long = "Lorem ipsum café ".repeat(250);      // > 3000 bytes, with accents at the cut
const rss = (items) => "<?xml version=\"1.0\"?>\n<rss><channel><title>Feed</title>\n" + items.map(i =>
    "<item>\n<title>" + i.t + "</title>\n<link>" + i.l + "</link>\n<pubDate>Sat, 21 Nov 2026 10:00:00 GMT</pubDate>\n" +
    (i.media ? "<media:content url=\"" + i.media + "\" medium=\"image\"/>\n" : "") +
    "<description>" + (i.d || "") + "</description>\n" + (i.ce ? "<content:encoded><![CDATA[" + i.ce + "]]></content:encoded>\n" : "") + "</item>\n").join("") + "</channel></rss>\n";
const WEB = {
    "open-meteo.com": '{"latitude":53.9,"current":{"temperature_2m":-3.5},"hourly":{"time":["a"],"temperature_2m":[-3]},"daily":{"time":["b"],"weather_code":[71]}}',
    "news-one.example/feed": rss([
        { t: "Big \"storm\" hits Prince George today", l: "https://news-one.example/a?b=1&amp;c=2", d: "Body with \\ backslash and <b>bold</b><br/>next line", media: "https://img.example/p.jpg" },
        { t: "Short", l: "https://news-one.example/s", d: "skipped: title under 8" },
        { t: "<![CDATA[Café owners & the long read]]>", l: "https://news-one.example/c", ce: "<p>" + long + "</p><div>tail</div>" },
        { t: "Third story with an image in the body", l: "https://news-one.example/d", d: "&lt;img src='https://img.example/q.jpg'&gt; text" }]),
    "news-two.example/rss": rss([{ t: "Second source headline here", l: "https://news-two.example/x", d: "Two" }]),
    "img.example/p.jpg": JPG, "img.example/q.jpg": JPG,
    "finance.yahoo.com/v8/finance/chart/%5EGSPC": '{"chart":{"result":[{"meta":{"regularMarketPrice":5001.25,"chartPreviousClose":4990.5},"indicators":{"quote":[{"close":[4991,null,4995.5,5000,5001.25]}]}}]}}',
    "finance.yahoo.com/v8/finance/chart/BTC-USD": '{"chart":{"result":[{"meta":{"regularMarketPrice":91234.5,"chartPreviousClose":90000},"indicators":{"quote":[{"close":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]}]}}]}}',
    "onthisday/events": '{"events":[{"text": "First \\"quoted\\" event", "pages": [], "year": 1999},{"text": "Second event", "pages": [], "year": -44},{"text": "Third event", "pages": [], "year": 1066}]}',
    "ckpgtoday.ca/tag/events/feed": rss([{ t: "Winter market at the civic centre", l: "https://ckpgtoday.ca/e1", d: "Saturday" }]),
    "rss-canada\u0000": "", "cbc.ca/webfeed/rss/rss-world": rss([{ t: "World headline number one", l: "https://cbc.ca/w1", d: "World" }]),
    "cbc.ca/webfeed/rss/rss-canada": rss([{ t: "Canada headline number one", l: "https://cbc.ca/c1", d: "Canada" }]),
    "weather.gc.ca": '<feed><entry><title>SNOWFALL WARNING IN EFFECT, Prince George</title><category term="Warnings and Watches"/></entry><entry><title>Current Conditions: -5C</title><category term="Current Conditions"/></entry></feed>',
    "open511": '{"events":[{"jurisdiction_url":"x","severity":"MAJOR","description":"Highway 97 closed at Hart Highway due to a collision"},{"jurisdiction_url":"y","severity":"MINOR","description":"minor thing"}]}',
    "recipetineats.com/feed": rss([{ t: "Chicken and leek pie for weeknights", l: "https://www.recipetineats.com/pie/", d: "Pie" }]),
    "budgetbytes.com/feed": rss([{ t: "One pot chili mac and cheese", l: "https://www.budgetbytes.com/chili/", d: "Chili" }]),
    "cookieandkate.com/feed": "",
    "recipetineats.com/pie": "<html><head><script type=\"application/ld+json\">{\"@type\":\"Recipe\",\"name\":\"Pie\",\"recipeIngredient\":[\"2 leeks\"]}</script></head></html>",
    "budgetbytes.com/chili": "<html><script type=\"application/ld+json\">{\"@type\":\"WebPage\"}</script></html>",
    "ohmanda.com": '{"sign":"x","horoscope":"A good day for \\"soup\\"."}'
};
const lookup = (url) => { let best = null; for (const k of Object.keys(WEB)) if (url.indexOf(k) >= 0 && (!best || k.length > best.length)) best = k; return best === null ? null : WEB[best]; };

function fakeCurl(dir) {      // a curl for sync_data.sh that answers from WEB
    const fix = path.join(dir, "web.json");
    fs.writeFileSync(fix, JSON.stringify(Object.fromEntries(Object.entries(WEB).map(([k, v]) => [k, Buffer.isBuffer(v) ? { b64: v.toString("base64") } : v]))));
    const f = path.join(dir, "curl");
    fs.writeFileSync(f, "#!" + process.execPath + "\n" +
        "const fs=require('fs');const W=JSON.parse(fs.readFileSync(" + JSON.stringify(fix) + ",'utf8'));const a=process.argv.slice(2);let o='',u='';\n" +
        "for(let i=0;i<a.length;i++){if(a[i]==='-o')o=a[++i];else if(/^(-A|-H|-r|--connect-timeout|--max-time|--max-filesize|--cacert)$/.test(a[i]))i++;else if(/^https?:/.test(a[i]))u=a[i];}\n" +
        "let best=null;for(const k in W)if(u.indexOf(k)>=0&&(!best||k.length>best.length))best=k;\n" +
        "if(best===null||W[best]===''){process.exit(22)}const v=W[best];const b=typeof v==='string'?Buffer.from(v):Buffer.from(v.b64,'base64');\n" +
        "if(o)fs.writeFileSync(o,b);else process.stdout.write(b);\n");
    fs.chmodSync(f, 0o755);
    return f;
}
const read = (f, v) => { try { return new Function("window", fs.readFileSync(f, "utf8") + "; return window." + v + ";")({}); } catch (e) { return { error: String(e) }; } };
const conf = "https://news-one.example/feed|ONE|6\nhttps://news-two.example/rss|TWO|3\n";
const stocks = "^GSPC:S&P\nBTC-USD:BTC\n";

(async () => {
    const A = fs.mkdtempSync(path.join(os.tmpdir(), "khpkA-")), B = fs.mkdtempSync(path.join(os.tmpdir(), "khpkB-"));
    [A, B].forEach(d => { fs.mkdirSync(path.join(d, "mesquite/rcp"), { recursive: true }); fs.writeFileSync(path.join(d, "news.conf"), conf); fs.writeFileSync(path.join(d, "stocks.conf"), stocks); });
    const curl = fakeCurl(fs.mkdtempSync(path.join(os.tmpdir(), "khcurl-")));
    const r = cp.spawnSync("sh", [ROOT + "/kindle/shiftcal/sync_data.sh"], { env: { PATH: process.env.PATH, HUB_DIR: A, CLOUD_BUNDLE: "1", CURL_BIN: curl, TZ: "PCT7" }, encoding: "utf8", timeout: 120000 });
    const now = Date.now();
    const getLog = [];
    await P.build(B, { now: () => now, get: async (u, o) => { getLog.push(u); const v = lookup(u); if (v === null || v === "") return null; return o && o.binary ? (Buffer.isBuffer(v) ? v : Buffer.from(v)) : String(v); } });

    const dA = read(A + "/mesquite/data.js", "HUB_DATA"), dB = read(B + "/mesquite/data.js", "HUB_DATA");
    await t("the shell run worked (reference)", () => assert.ok(dA && dA.articles, "sync_data.sh: " + (r.stderr || "") + JSON.stringify(dA).slice(0, 200)));
    await t("data.js: weather identical", () => assert.deepStrictEqual(dB.wx, dA.wx));
    await t("data.js: news identical (titles, links, bodies cut at 3000 bytes, photos)", () => {
        assert.strictEqual(dB.articles.length, dA.articles.length);
        dA.articles.forEach((a, i) => assert.deepStrictEqual(dB.articles[i], a, "story " + i));
        assert.ok(Buffer.byteLength(dB.articles.find(a => /long read/.test(a.t)).b) <= 3000);
    });
    await t("data.js: markets identical", () => assert.deepStrictEqual(dB.stocks, dA.stocks));
    await t("data.js: on this day identical", () => assert.deepStrictEqual(dB.onThisDay, dA.onThisDay));
    await t("data.js: 'updated' and time", () => { assert.strictEqual(dB.updated, dA.updated); assert.ok(Math.abs(dB.ts - dA.ts) < 120); });
    await t("what's on identical (events, Canada, world, weather + road alerts)", () => {
        const a = read(A + "/mesquite/whatson.js", "HUB_WHATSON"), b = read(B + "/mesquite/whatson.js", "HUB_WHATSON");
        ["pg", "canada", "world", "alerts"].forEach(k => assert.deepStrictEqual(b[k], a[k], k));
    });
    await t("recipe feed and recipe cards identical", () => {
        const a = read(A + "/mesquite/rfeed.js", "HUB_RFEED"), b = read(B + "/mesquite/rfeed.js", "HUB_RFEED");
        assert.deepStrictEqual(b.items, a.items); assert.deepStrictEqual(b.ld, a.ld);
        const ca = fs.readdirSync(A + "/mesquite/rcp").sort(), cb = fs.readdirSync(B + "/mesquite/rcp").sort();
        assert.deepStrictEqual(cb, ca); ca.forEach(f => assert.strictEqual(fs.readFileSync(B + "/mesquite/rcp/" + f, "utf8"), fs.readFileSync(A + "/mesquite/rcp/" + f, "utf8")));
    });
    await t("horoscopes identical", () => assert.deepStrictEqual(read(B + "/mesquite/horo.js", "HUB_HORO"), read(A + "/mesquite/horo.js", "HUB_HORO")));
    await t("photos and the package's photo list identical", () => {
        assert.deepStrictEqual(fs.readdirSync(B + "/mesquite/img").sort(), fs.readdirSync(A + "/mesquite/img").sort());
        const lines = f => [...new Set(fs.readFileSync(f, "utf8").trim().split("\n"))].sort();
        assert.deepStrictEqual(lines(B + "/.img_urls"), lines(A + "/.img_urls"));
    });
    await t("every file is valid JavaScript for the Kindle (no U+2028, no control characters)", () => {
        ["data.js", "whatson.js", "rfeed.js", "horo.js"].forEach(f => { const s = fs.readFileSync(B + "/mesquite/" + f, "utf8"); assert.ok(!/[\u2028\u2029\u0000-\u0008]/.test(s), f); new Function("window", s); });
    });
    await t("second build soon after: what's on and recipes are not fetched again (due times carried)", async () => {
        getLog.length = 0;
        await P.build(B, { now: () => now + 30 * 60000, get: async (u, o) => { getLog.push(u); const v = lookup(u); return v === null || v === "" ? null : o && o.binary ? v : String(v); } });
        assert.ok(!getLog.some(u => /tag\/events|recipetineats.com\/feed/.test(u)), getLog.join(" "));
    });
    await t("recipe search on the PC", async () => {
        WEB["recipetineats.com/?s="] = rss([{ t: "Leek soup with crusty bread", l: "https://www.recipetineats.com/pie/", d: "Soup" }]);
        const s = await P.search(B, "leek soup!", { get: async (u) => { const v = lookup(u); return v === null || v === "" ? null : String(v); } });
        const o = new Function("window", s + "; return window.HUB_RSEARCH;")({});
        assert.strictEqual(o.q, "leek soup"); assert.strictEqual(o.items.length, 1); assert.ok(o.ld["https://www.recipetineats.com/pie/"]);
    });
    await t("nothing reachable: no data.js written, no crash", async () => {
        const C = fs.mkdtempSync(path.join(os.tmpdir(), "khpkC-"));
        const r2 = await P.build(C, { get: async () => null });
        assert.ok(!r2.wx && !fs.existsSync(C + "/mesquite/data.js"));
    });
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
