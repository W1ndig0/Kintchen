/* Kitchen Hub v11 - the fridge's package (weather, news, markets, on this day, what's on, recipes, horoscopes)
 * built in Node: a port of kindle/shiftcal/sync_data.sh's cloud mode (CLOUD_BUNDLE=1), so it runs on Windows
 * without a shell. It writes the same files into the same folder layout; brain.js packs them exactly as before.
 *   mesquite/data.js   window.HUB_DATA = { ts, updated, wx, articles, stocks, onThisDay }
 *   mesquite/whatson.js, mesquite/rfeed.js, mesquite/rcp/<id>.js, mesquite/horo.js, mesquite/img/*, .img_urls
 *   .due_*, .stocks_cache, .whatson_cache, .otd_MMDD   (state carried from one package to the next)
 * Also search(q): the recipe search the Kindle used to do itself (sync_data.sh "search").
 * The hub's clock is fixed at UTC-7 (Prince George), like the Kindle (TZ=PCT7). */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const TZ_MS = -7 * 3600000;
const W_URL = "https://api.open-meteo.com/v1/forecast?latitude=53.9171&longitude=-122.7497&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,snowfall_sum,precipitation_probability_max&timezone=Etc%2FGMT%2B7&forecast_days=5";
const RECIPE_SITES = [["https://www.recipetineats.com/", "RECIPETIN"], ["https://www.budgetbytes.com/", "BUDGET BYTES"], ["https://cookieandkate.com/", "COOKIE+KATE"]];
const DEFAULT_NEWS = [["https://ckpgtoday.ca/feed/", "CKPG", 8], ["https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia", "CBC BC", 6]];
const DEFAULT_STOCKS = "^GSPC:S&P ^IXIC:NDX ^GSPTSE:TSX BTC-USD:BTC";
const SIGNS = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"];
const MAX_NEW_IMAGES = 8, IMG_MAX = 3000000;

// network: get(url, { ua, ms, binary }) -> string | Buffer | null (tests pass their own)
async function netGet(url, o) {
    o = o || {};
    try {
        const r = await fetch(url, { headers: { "User-Agent": o.ua || "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(o.ms || 15000) });
        if (!r.ok) return null;
        if (o.binary) { const b = Buffer.from(await r.arrayBuffer()); return b.length > IMG_MAX ? null : b; }
        return await r.text();
    } catch (e) { return null; }
}

const local = (now) => new Date(now + TZ_MS);        // read with getUTC*
const pad = (n) => (n < 10 ? "0" : "") + n;
const js = (s) => JSON.stringify(String(s)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex").slice(0, 12);
const oneLine = (s) => String(s || "").replace(/[\r\n\t]/g, " ");

// sed 's#.*<tag[^>]*>\(.*\)</tag>.*#\1#p' on one line
function tag(line, name) { const m = new RegExp("^.*<" + name.replace(/:/g, "\\:") + "[^>]*>(.*)</" + name + ">.*$").exec(line); return m ? m[1] : ""; }
function clean(s) {
    return String(s).replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<\/p>/g, "@@P@@").replace(/<\/div>/g, "@@P@@")
                    .replace(/<br *\/?>/g, "@@P@@").replace(/<[^>]*>/g, "").replace(/  +/g, " ");
}
// cut to n BYTES of UTF-8 without leaving half a character (cut8)
function cut8(s, n) {
    const b = Buffer.from(String(s), "utf8"); if (b.length <= n) return String(s);
    let e = n; while (e > 0 && (b[e] & 0xc0) === 0x80) e--;
    return b.subarray(0, e).toString("utf8");
}
function imageUrl(item) {
    const r = item.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    const pats = [/^.*<enclosure[^>]*url="([^"]*)"[^>]*type="image[^"]*".*$/, /^.*<media:content[^>]*url="([^"]*)".*$/, /^.*<media:thumbnail[^>]*url="([^"]*)".*$/,
                  /^.*<img[^>]*src="([^"]*)".*$/, /^.*<img[^>]*src='([^']*)'.*$/];
    for (const p of pats) { const m = p.exec(r); if (m && /^http/.test(m[1])) return m[1].replace(/&amp;/g, "&"); }
    return "";
}
function imgExt(b) {
    if (!b || b.length < 4) return "";
    if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
    return "";
}

class Builder {
    constructor(dir, opts) {
        this.dir = dir; this.mesq = path.join(dir, "mesquite"); this.imgDir = path.join(this.mesq, "img");
        this.get = (opts && opts.get) || netGet; this.now = (opts && opts.now) || Date.now;
        this.t0 = this.now(); this.budget = (opts && opts.budgetMs) || 240000;
        this.imgsNew = 0; this.log = (opts && opts.log) || (() => {});
        [this.mesq, this.imgDir, path.join(this.mesq, "rcp")].forEach(d => fs.mkdirSync(d, { recursive: true }));
    }
    over() { return this.now() - this.t0 >= this.budget; }
    f(rel) { return path.join(this.dir, rel); }
    write(rel, text) { const f = this.f(rel), tmp = f + ".tmp"; fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); }
    due(name, minutes) {
        const f = this.f(".due_" + name), nowS = Math.floor(this.now() / 1000);
        let last = 0; try { last = parseInt(fs.readFileSync(f, "utf8").replace(/\D/g, "").slice(0, 12), 10) || 0; } catch (e) {}
        if (last && nowS - last < minutes * 60 - 120) return false;
        fs.writeFileSync(f, nowS + "\n"); return true;
    }
    // one RSS feed -> article objects (the shell's add_feed); images downloaded and recorded for the package
    async feed(url, source, max) {
        if (this.over()) return [];
        const raw = await this.get(url, { ms: 15000 });
        if (!raw || raw.indexOf("<item") < 0) return [];
        const items = oneLine(raw).split("</item>").filter(l => l.indexOf("<item") >= 0), out = [];
        for (const line of items) {
            if (out.length >= max) break;
            const L = line.replace(/^.*<item[ >]/, "");
            const t = clean(tag(L, "title")).replace(/@@P@@/g, " ");
            if (t.length < 8) continue;
            let b = tag(L, "content:encoded"); if (!b) b = tag(L, "description");
            const a = { s: source, t, p: clean(tag(L, "pubDate")), l: clean(tag(L, "link")), b: cut8(clean(b), 3000) };
            const iu = imageUrl(L);
            if (iu) {
                const h = md5(iu);
                let rel = ["jpg", "png", "gif"].map(e => "img/" + h + "." + e).find(r => fs.existsSync(path.join(this.mesq, r))) || "";
                if (!rel && this.imgsNew < MAX_NEW_IMAGES) {
                    const bin = await this.get(iu, { binary: true, ms: 10000 }), e = imgExt(bin);
                    if (e) { rel = "img/" + h + "." + e; fs.writeFileSync(path.join(this.mesq, rel), bin); this.imgsNew++; }
                }
                if (rel) { a.img = rel; fs.appendFileSync(this.f(".img_urls"), rel + " " + iu + "\n"); }
            }
            out.push(a);
        }
        return out;
    }
    // JSON-LD recipe cards for the links, at most maxNew downloads -> { link: id }
    async cards(arts, maxNew) {
        const idx = {}; let n = 0;
        for (const a of arts) {
            if (this.over()) break;
            const h = md5(a.l), f = path.join(this.mesq, "rcp", h + ".js");
            if (!fs.existsSync(f) && n < maxNew) {
                const html = oneLine(await this.get(a.l, { ms: 15000 }) || "");
                const ld = html.split("<script").map(c => "<script" + c).find(c => /application\/ld\+json/i.test(c) && c.indexOf("recipeIngredient") >= 0);
                if (ld) {
                    const body = ld.replace(/^<script[^>]*>/, "").replace(/<\/script>.*$/, "");
                    fs.writeFileSync(f, "window.RCPLD=window.RCPLD||{};window.RCPLD[\"" + h + "\"]=" + body + ";\n"); n++;
                }
            }
            if (fs.existsSync(f)) idx[a.l] = h;
        }
        return idx;
    }

    async weather() {
        const raw = oneLine(await this.get(W_URL, { ms: 12000 }) || "").trim();
        if (/^\{/.test(raw) && /\}$/.test(raw) && raw.indexOf('"hourly"') > 0 && raw.indexOf('"daily"') > 0) { try { JSON.parse(raw); return raw; } catch (e) {} }
        return null;
    }
    newsConf() {
        try {
            const l = fs.readFileSync(this.f("news.conf"), "utf8").replace(/\r/g, "").split("\n").map(x => x.split("|")).filter(x => /^http/.test(x[0]));
            if (l.length) return l.map(x => [x[0], x[1] || "", parseInt(String(x[2] || "").replace(/\D/g, ""), 10) || 6]);
        } catch (e) {}
        return DEFAULT_NEWS;
    }
    async markets(L) {
        const open = L.dow <= 5 && L.hour >= 6 && L.hour <= 14;
        const cacheF = this.f(".stocks_cache"), cache = fs.existsSync(cacheF) ? fs.readFileSync(cacheF, "utf8") : "";
        if (!open && cache && !this.due("markets_closed", 360)) return cache;
        if (this.over()) return cache || "[]";
        let syms = DEFAULT_STOCKS;
        try { const c = fs.readFileSync(this.f("stocks.conf"), "utf8").replace(/\r/g, "").split("\n").filter(x => x.trim() && !/^\s*#/.test(x)); if (c.length) syms = c.join(" "); } catch (e) {}
        const out = [];
        for (const pair of syms.split(/\s+/).filter(Boolean)) {
            const i = pair.indexOf(":"), sym = i < 0 ? pair : pair.slice(0, i), lbl = i < 0 ? pair : pair.slice(i + 1);
            const raw = await this.get("https://query1.finance.yahoo.com/v8/finance/chart/" + sym.replace(/\^/g, "%5E").replace(/=/g, "%3D") + "?range=1d&interval=15m", { ms: 8000 });
            let j; try { j = JSON.parse(raw).chart.result[0]; } catch (e) { continue; }
            const price = j && j.meta && j.meta.regularMarketPrice;
            if (typeof price !== "number" || !isFinite(price)) continue;
            const prev = typeof j.meta.chartPreviousClose === "number" ? j.meta.chartPreviousClose : price;
            let closes = []; try { closes = j.indicators.quote[0].close.filter(v => typeof v === "number"); } catch (e) {}
            const n = closes.length, k = Math.min(12, n), spark = [];
            for (let q = 0; q < k; q++) spark.push(closes[Math.floor(q * (n - 1) / (k > 1 ? k - 1 : 1))]);
            out.push({ sym: lbl, price, prev, spark });
        }
        if (!out.length) return cache || "[]";
        const s = JSON.stringify(out); fs.writeFileSync(cacheF, s); return s;
    }
    async onThisDay(L) {
        const key = ".otd_" + pad(L.month) + pad(L.day), f = this.f(key);
        try { const c = fs.readFileSync(f, "utf8"); const o = JSON.parse(c); if (typeof o.year === "number" && typeof o.text === "string") return c; } catch (e) {}
        let j; try { j = JSON.parse(await this.get("https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/" + pad(L.month) + "/" + pad(L.day), { ua: "KitchenHub/9.2", ms: 10000 })); } catch (e) { return "null"; }
        const ev = (j && j.events || []).filter(e => typeof e.text === "string");
        if (!ev.length) return "null";
        const e = ev[L.doy % ev.length], s = JSON.stringify({ year: parseInt(e.year, 10) || 0, text: e.text });
        fs.readdirSync(this.dir).filter(x => /^\.otd_/.test(x)).forEach(x => fs.unlinkSync(this.f(x)));
        fs.writeFileSync(f, s); return s;
    }
    async whatson() {
        let pg = [], ca = [], wo = [];
        const cf = this.f(".whatson_cache");
        if (!this.over() && this.due("whatson", 180)) {
            pg = await this.feed("https://ckpgtoday.ca/tag/events/feed/", "PG EVENTS", 6);
            ca = await this.feed("https://www.cbc.ca/webfeed/rss/rss-canada", "CANADA", 6);
            wo = await this.feed("https://www.cbc.ca/webfeed/rss/rss-world", "WORLD", 6);
            fs.writeFileSync(cf, JSON.stringify([pg, ca, wo]));
        } else { try { [pg, ca, wo] = JSON.parse(fs.readFileSync(cf, "utf8")); } catch (e) {} }
        const alerts = [];
        const ec = oneLine(await this.get("https://weather.gc.ca/rss/weather/53.912_-122.776_e.xml", { ua: "KitchenHub/10.3", ms: 12000 }) || "");
        ec.split("</entry>").filter(e => /term="Warnings and Watches"/i.test(e)).forEach(e => {
            const m = /<title>([^<]*)<\/title>/.exec(e); if (m && m[1] && m[1].indexOf("No watches or warnings") < 0) alerts.push({ s: "WEATHER", t: m[1] });
        });
        let rd = null; try { rd = JSON.parse(await this.get("https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&bbox=-124.0,53.4,-121.6,54.4&limit=40", { ua: "KitchenHub/10.3", ms: 12000 })); } catch (e) {}
        let nr = 0;
        ((rd && rd.events) || []).forEach(e => {
            if (nr >= 4 || !/^(MAJOR|MODERATE)$/.test(e.severity || "") || !e.description) return;
            alerts.push({ s: "ROAD", t: cut8(e.description, 220) }); nr++;
        });
        if (pg.length || ca.length || wo.length || alerts.length) {
            this.write("mesquite/whatson.js", "window.HUB_WHATSON={ts:" + Math.floor(this.now() / 1000) + ",pg:" + JSON.stringify(pg) + ",canada:" + JSON.stringify(ca) +
                                               ",world:" + JSON.stringify(wo) + ",alerts:" + JSON.stringify(alerts) + "};\n");
        }
    }
    async recipes() {
        if (this.over() || !this.due("recipes", 360)) return;
        let rf = [];
        for (const [u, n] of RECIPE_SITES) rf = rf.concat(await this.feed(u + "feed/", n, 4));
        if (!rf.length) return;
        const idx = await this.cards(rf, 6);
        this.write("mesquite/rfeed.js", "window.HUB_RFEED={ts:" + Math.floor(this.now() / 1000) + ",items:" + JSON.stringify(rf) + ",ld:" + JSON.stringify(idx) + "};\n");
        this.trimCards();
    }
    trimCards() {
        const d = path.join(this.mesq, "rcp");
        fs.readdirSync(d).map(f => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(60).forEach(x => fs.unlinkSync(path.join(d, x.f)));
    }
    async horoscopes(today) {
        const hf = path.join(this.mesq, "horo.js");
        if (this.over() || (fs.existsSync(hf) && fs.readFileSync(hf, "utf8").indexOf('date:"' + today + '"') >= 0)) return;
        const signs = {};
        for (const s of SIGNS) {
            let j; try { j = JSON.parse(await this.get("https://ohmanda.com/api/horoscope/" + s + "/", { ua: "KitchenHub/9.6", ms: 8000 })); } catch (e) { continue; }
            if (j && typeof j.horoscope === "string" && j.horoscope) signs[s] = j.horoscope;
        }
        if (Object.keys(signs).length >= 10) this.write("mesquite/horo.js", "window.HUB_HORO={date:\"" + today + "\",signs:" + JSON.stringify(signs) + "};\n");
    }

    async build() {
        const L0 = local(this.now()), L = { hour: L0.getUTCHours(), dow: L0.getUTCDay() || 7, month: L0.getUTCMonth() + 1, day: L0.getUTCDate(),
                                            doy: Math.floor((Date.UTC(L0.getUTCFullYear(), L0.getUTCMonth(), L0.getUTCDate()) - Date.UTC(L0.getUTCFullYear(), 0, 1)) / 864e5) + 1 };
        const wx = await this.weather();
        let arts = [];
        for (const [u, t, m] of this.newsConf()) arts = arts.concat(await this.feed(u, t, m));
        const stocks = await this.markets(L), otd = await this.onThisDay(L);
        await this.whatson(); await this.recipes();
        await this.horoscopes(L0.getUTCFullYear() + "-" + pad(L.month) + "-" + pad(L.day));
        if (wx || arts.length || stocks !== "[]") {
            const h12 = L.hour % 12 || 12;
            const text = "window.HUB_DATA = {\n    ts: " + Math.floor(this.now() / 1000) + ",\n    updated: " + js(h12 + ":" + pad(L0.getUTCMinutes()) + " " + (L.hour < 12 ? "AM" : "PM")) +
                         ",\n    wx: " + (wx || "null") + ",\n    articles: " + JSON.stringify(arts) + ",\n    stocks: " + stocks + ",\n    onThisDay: " + otd + "\n};\n";
            this.write("mesquite/data.js", text.replace(/\u2028/g, " ").replace(/\u2029/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""));
        }
        // the photo cache: newest 40
        fs.readdirSync(this.imgDir).map(f => ({ f, t: fs.statSync(path.join(this.imgDir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(40)
          .forEach(x => fs.unlinkSync(path.join(this.imgDir, x.f)));
        this.log("package: weather " + (wx ? "ok" : "failed") + ", " + arts.length + " stories, " + this.imgsNew + " new photos");
        return { wx: !!wx, stories: arts.length };
    }
    // recipe search -> the text of rsearch.js
    async search(q) {
        q = String(q || "").replace(/[^A-Za-z0-9 -]/g, "").slice(0, 40);
        let rf = [];
        for (const [u, n] of RECIPE_SITES) rf = rf.concat(await this.feed(u + "?s=" + q.replace(/ /g, "+") + "&feed=rss2", n, 5));
        const idx = await this.cards(rf, 8);
        return "window.HUB_RSEARCH={q:" + js(q) + ",ts:" + Math.floor(this.now() / 1000) + ",items:" + JSON.stringify(rf) + ",ld:" + JSON.stringify(idx) + "};\n";
    }
}
async function build(dir, opts) { return new Builder(dir, opts).build(); }
async function search(dir, q, opts) { return new Builder(dir, opts).search(q); }
module.exports = { build, search, Builder, tag, clean, cut8, imageUrl, imgExt };
