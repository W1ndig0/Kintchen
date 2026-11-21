/* Kitchen Hub 10.0 cloud extras: deals (Best Buy wishlist, Flipp flyers for V2N, RedFlagDeals hot deals),
 * money / pantry / package / Canucks reminders, and the daily fun (trivia, word of the day).
 * Writes ONE locked file to the cloud gist, extra.js, that the fridge and the phone both read.
 * Prints counts only (public logs).
 * 10.4: the pantry settings (ctx.pantryCfg, from pantry.js) switch the evening "use it up" push and the
 *       recipe ideas on/off, and out.cook lists your saved recipes that use food about to expire.          */
"use strict";
function bigSale(now) {     // Black Friday week + Boxing week: check hot deals every 20 min
    const n = new Date(now + (+(process.env.TZ_HOURS || -7)) * 3600000), m = n.getUTCMonth(), d = n.getUTCDate();      // 10.1.2: same clock as the brain (was UTC-8)
    if (m === 10) { const f = new Date(Date.UTC(n.getUTCFullYear(), 10, 1)).getUTCDay(), thu = 1 + (4 - f + 7) % 7 + 21; if (d >= thu && d <= thu + 4) return true; }
    return (m === 11 && d >= 26) || (m === 0 && d <= 1);
}
// a pantry name as it would appear in a recipe's ingredient line ("Leftovers: chili" -> "chili", "Eggs" -> "egg")
function ingWord(name) { return String(name || "").toLowerCase().replace(/^leftovers?:\s*/, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim().replace(/(es|s)$/, ""); }
// 10.7: a Best Buy product on sale -> a deal card (the photo is downloaded by the Kindle: img/d<hash>.jpg)
const crypto = require("crypto");
// marketplace sellers (custom-painted controllers etc.) post made-up "regular" prices, so only Best Buy's own prices count as a sale
function onSale(p) { const s = +p.salePrice, r = +p.regularPrice; return !p.isMarketplace && s > 0 && r > 0 && s < r - 0.5; }
function bbDeal(p) {
    const price = +p.salePrice || +p.regularPrice || 0, reg = +p.regularPrice || price, src = String(p.thumbnailImage || "");
    const img = /^https:\/\/[^\s"'<>]+$/.test(src) ? "img/d" + crypto.createHash("md5").update(src).digest("hex").slice(0, 12) + (/\.png(\?|$)/i.test(src) ? ".png" : ".jpg") : "";
    return { sku: String(p.sku || ""), title: String(p.name || "").slice(0, 90), price, reg, off: reg > price ? Math.round((1 - price / reg) * 100) : 0,
             img, src: img ? src : "", url: p.productUrl ? "https://www.bestbuy.ca" + p.productUrl : "", ends: p.saleEndDate || "", clear: !!p.isClearance, store: "Best Buy" };
}
module.exports = async function runExtras(ctx) {
    const { items, push, sent, mark, NOW, TODAY, TOMORROW, HOUR, DOW, addK, get, HubCal, decodeEnts, log } = ctx;
    const PC = ctx.pantryCfg || { on: { remind: true, cook: true } };
    const st = ctx.state;                       // persisted in the cloud gist as extras_state.json
    st.wish = st.wish || {}; st.flyer = st.flyer || {}; st.hot = st.hot || {}; st.fun = st.fun || {}; st.nhl = st.nhl || {};
    const POSTAL = process.env.POSTAL || "V2N4Z9";
    const due = (key, mins) => !st[key + "At"] || NOW - st[key + "At"] > mins * 60000 || NOW < st[key + "At"];
    const J = async (u, ms) => { const t = await get(u, ms || 15000, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KitchenHub", Accept: "application/json" } }); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    const quiet = HOUR < 7 || HOUR >= 22;
    const out = { ts: Math.floor(NOW / 1000), deals: [], wish: [], flyers: [], hot: [], trivia: null, wotd: null, nhl: [], money: null, pantry: [], pkgs: [], cook: [], last7: null };

    // ---------------- wishlist: Best Buy Canada prices ----------------
    const wishes = items("wish").filter(w => w.state === "open" && w.text).map(w => ({ id: w.id, ...HubCal.parseRec("wish", w.text) }));
    if (wishes.length && due("wish", 180)) {
        st.wishAt = NOW; let n = 0;
        // 10.1.2: more than 12 watched items -> check the 12 that waited longest (items 13+ were never checked)
        const order = wishes.slice().sort((a, b) => ((st.wish[a.id] || {}).at || 0) - ((st.wish[b.id] || {}).at || 0));
        for (const w of order.slice(0, 12)) {
            const q = encodeURIComponent(w.query || w.name);
            const j = await J("https://www.bestbuy.ca/api/v2/json/search?query=" + q + "&lang=en-CA&pageSize=12&sortBy=relevance");
            if (!j || !Array.isArray(j.products) || !j.products.length) continue;
            const p = j.products.find(x => x.isVisible !== false) || j.products[0];
            const s = st.wish[w.id] = st.wish[w.id] || { hist: [] };
            s.at = NOW;
            const price = +p.salePrice || +p.regularPrice, last = s.price;
            s.title = p.name; s.price = price; s.reg = +p.regularPrice || price; s.url = "https://www.bestbuy.ca" + (p.productUrl || ""); s.img = p.thumbnailImage || ""; s.sku = p.sku;
            s.ends = p.saleEndDate || ""; s.clear = !!p.isClearance; s.cat = p.categoryName || s.cat || "";
            // 10.7: other results of the same search that are on sale = "similar items on sale" for the Deals page
            s.sales = j.products.filter(x => x !== p && x.isVisible !== false && onSale(x)).map(bbDeal).sort((a, b) => b.off - a.off).slice(0, 4);
            if (!s.hist.length || s.hist[s.hist.length - 1][1] !== price) s.hist.push([Math.floor(NOW / 1000), price]);
            if (s.hist.length > 60) s.hist = s.hist.slice(-60);
            s.low = Math.min.apply(null, s.hist.map(h => h[1]));
            n++;
            const hitTarget = w.target > 0 && price <= w.target, bigDrop = last && price <= last * 0.9;
            const key = "wish" + w.id + price;
            if ((hitTarget || bigDrop) && !sent(key) && !quiet) {
                mark(key);
                await push((hitTarget ? "Target hit: " : "Price drop: ") + w.name, s.title + "\n$" + price.toFixed(2) + (s.reg > price ? " (reg $" + s.reg.toFixed(2) + ")" : "") + (last && last !== price ? " - was $" + last.toFixed(2) : "") + " at Best Buy" + (s.ends ? "\nSale ends " + String(s.ends).slice(0, 10) : ""), "moneybag", hitTarget ? 4 : 3);
            }
        }
        log("wishlist: " + n + "/" + wishes.length + " priced");
    }
    // ---------------- 10.7: the Deals page - at least five deals from your wishlist ----------------
    // 1 wishlist items on sale (or at your target), 2 similar items on sale from the same searches,
    // 3 if still fewer than five: a broader search (the item's category, or its first words) for sales.
    const seenSku = {}, deals = [];
    const addDeal = (d, kind, forName) => { if (!d || !d.price || (d.sku && seenSku[d.sku])) return; if (d.sku) seenSku[d.sku] = 1; deals.push(Object.assign({ kind, for: forName }, d)); };
    for (const w of wishes) { const s = st.wish[w.id]; if (s && s.price && (s.price < s.reg - 0.5 || (w.target > 0 && s.price <= w.target))) addDeal(bbDeal({ sku: s.sku, name: s.title, salePrice: s.price, regularPrice: s.reg, thumbnailImage: s.img, productUrl: (s.url || "").replace("https://www.bestbuy.ca", ""), saleEndDate: s.ends, isClearance: s.clear }), w.target > 0 && s.price <= w.target ? "target" : "wish", w.name); }
    const sim = [];
    for (const w of wishes) { const s = st.wish[w.id]; (s && s.sales || []).forEach(d => sim.push([d, w.name])); }
    sim.sort((a, b) => b[0].off - a[0].off).forEach(x => addDeal(x[0], "similar", x[1]));
    if (wishes.length && deals.length < 5 && due("fill", 360)) {
        st.fillAt = NOW; st.fill = [];
        for (const w of wishes.slice(0, 3)) {
            const s = st.wish[w.id] || {}, q = s.cat || String(w.query || w.name).split(/\s+/).slice(0, 2).join(" ");
            const j = await J("https://www.bestbuy.ca/api/v2/json/search?query=" + encodeURIComponent(q) + "&lang=en-CA&pageSize=24&sortBy=relevance");
            if (j && Array.isArray(j.products)) j.products.filter(x => x.isVisible !== false && onSale(x)).map(bbDeal).sort((a, b) => b.off - a.off).slice(0, 6).forEach(d => st.fill.push(Object.assign({ like: w.name }, d)));
        }
        log("deals: broader search added " + st.fill.length);
    }
    if (deals.length < 5) (st.fill || []).forEach(d => addDeal(d, "similar", d.like));
    out.deals = deals.slice(0, 12);
    // ---------------- 10.7: big this week (Almanac): releases + related headlines and deals ----------------
    if (!st.week || due("week", 360)) {
        st.weekAt = NOW;
        try { const wk = await require("./week.js")({ get, TODAY, addK, log, decodeEnts, bbDeal, onSale }); if (wk && (wk.events.length || !st.week)) st.week = wk; }
        catch (e) { log("week failed: " + String(e.message || e).slice(0, 80)); }
    }
    out.week = st.week || null;
    for (const w of wishes) {
        const s = st.wish[w.id] || {};
        out.wish.push({ id: w.id, name: w.name, target: w.target, title: s.title || "", price: s.price || 0, reg: s.reg || 0, low: s.low || 0, url: s.url || "", ends: s.ends || "", clear: !!s.clear, hist: (s.hist || []).slice(-20).map(h => h[1]), hit: !!(w.target && s.price && s.price <= w.target), sale: !!(s.reg && s.price && s.price < s.reg) });
    }

    // ---------------- grocery flyers: your list vs this week's flyers near V2N ----------------
    const shop = items("shop").filter(s => s.state === "open" && s.text).map(s => HubCal.parseShop(s.text).name).filter(Boolean);
    const shopSig = shop.slice().sort().join(",");
    if (shop.length && (due("flyer", 360) || (st.flyer && st.flyer.sig !== shopSig && due("flyer", 30)))) {     // 10.1.1: new list items get checked within ~30 min
        st.flyerAt = NOW;
        // 10.1.2: keep what we know about items not looked up this time; look up the 20 that waited longest (21+ were never checked)
        const old = (st.flyer && st.flyer.matches) || {}, seen = (st.flyer && st.flyer.seen) || {}, matches = {}, seenNow = {};
        for (const name of shop) { if (old[name]) matches[name] = old[name]; if (seen[name]) seenNow[name] = seen[name]; }
        const pick = shop.slice().sort((a, b) => (seenNow[a] || 0) - (seenNow[b] || 0)).slice(0, 20);
        for (const name of pick) {
            const j = await J("https://backflipp.wishabi.com/flipp/items/search?locale=en-ca&postal_code=" + POSTAL + "&q=" + encodeURIComponent(name));
            if (!j) continue;                       // no answer (outage): keep what we knew instead of wiping it
            seenNow[name] = NOW; delete matches[name];
            const its = j && Array.isArray(j.items) ? j.items.filter(x => x.current_price > 0 && (!x.valid_to || Date.parse(x.valid_to) > NOW)) : [];
            if (!its.length) continue;
            const words = name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const good = its.filter(x => words.every(w => String(x.name || "").toLowerCase().indexOf(w.replace(/s$/, "")) >= 0));
            if (words.length && !good.length) continue;          // 10.1.1: nothing that is really this item -> no match (was: any search hit)
            const pool = (good.length ? good : its).sort((a, b) => a.current_price - b.current_price).slice(0, 3);
            matches[name] = pool.map(x => ({ store: x.merchant_name, item: String(x.name || "").slice(0, 60), price: x.current_price, was: x.original_price || 0, unit: [x.pre_price_text, x.post_price_text].filter(Boolean).join(" ").slice(0, 20), story: String(x.sale_story || "").slice(0, 40), to: String(x.valid_to || "").slice(0, 10) }));
        }
        st.flyer = { matches, sig: shopSig, seen: seenNow };
        log("flyers: " + Object.keys(matches).length + "/" + shop.length + " list items on sale");
    }
    const fm = (st.flyer && st.flyer.matches) || {};
    for (const name of shop) {
        const live = (fm[name] || []).filter(x => !x.to || x.to >= TODAY);          // 10.1.2: a sale that ended isn't shown until the next check
        if (live.length) out.flyers.push({ name, best: live[0], more: live.slice(1) });
    }
    // Thursday evening (new flyers): one summary push
    if (DOW === 4 && HOUR >= 18 && HOUR < 21 && out.flyers.length && !sent("flyer" + TODAY)) {
        mark("flyer" + TODAY);
        await push(out.flyers.length === 1 ? "1 thing on your list is on sale" : out.flyers.length + " things on your list are on sale", out.flyers.slice(0, 8).map(f => f.name + ": $" + f.best.price.toFixed(2) + " " + f.best.store).join("\n"), "shopping_cart", 2);
    }

    // ---------------- RedFlagDeals hot deals ----------------
    if (due("hot", bigSale(NOW) ? 20 : 60)) {
        st.hotAt = NOW;
        const j = await J("https://forums.redflagdeals.com/api/topics?forum_id=9&per_page=40&page=1");
        const ts = j && Array.isArray(j.topics) ? j.topics : [];
        if (ts.length) {
            st.hot = { list: ts.map(t => ({
                t: decodeEnts(String(t.title || "")).slice(0, 120),
                score: ((t.votes && (t.votes.total_up || 0) - (t.votes.total_down || 0)) || 0),
                store: (t.offer && t.offer.dealer_name) || "",
                price: (t.offer && t.offer.price) || "",
                url: t.web_path ? "https://forums.redflagdeals.com" + t.web_path : ""
            })).sort((a, b) => b.score - a.score).slice(0, 25) };
            log("hot deals: " + st.hot.list.length);
        }
    }
    out.hot = (st.hot.list || []).slice(0, 25);
    // a hot deal that matches something on your wishlist = push
    for (const h of out.hot) for (const w of wishes) {
        const words = (w.query || w.name).toLowerCase().split(/\s+/).filter(x => x.length > 2);
        if (words.length && words.every(x => h.t.toLowerCase().indexOf(x) >= 0)) {
            const key = "hot" + (h.url ? h.url.slice(-40) : h.t.slice(0, 40));
            if (!sent(key) && !quiet) { mark(key); await push("Hot deal: " + w.name, h.t + (h.store ? " @ " + h.store : "") + (h.price ? " - " + h.price : ""), "fire", 3); }
        }
    }

    // ---------------- money: bills, spending, split, budgets, goals ----------------
    const pc = (() => { const c = items("cfg").find(x => x.id === "money" && x.text); try { const o = c ? JSON.parse(c.text) : {}; return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } })();
    const bills = items("bill").filter(b => b.state === "open" && b.text).map(b => ({ id: b.id, ...HubCal.parseRec("bill", b.text) }));
    const paid = {}; items("billpd").forEach(p => { if (p.state === "open") paid[p.id] = 1; });
    const upcoming = [];
    for (const b of bills) {
        const r = HubCal.parseRepeat(b.rule + "||" + b.name + "|"); if (!r) continue;
        for (let i = -3; i <= 31; i++) { const k = addK(TODAY, i); if (HubCal.repeatOn(r, k)) upcoming.push({ id: b.id, name: b.name, amount: b.amount, date: k, autopay: b.autopay, who: b.who, paid: !!paid["bp" + b.id + k.replace(/-/g, "")] }); }
    }
    upcoming.sort((a, b) => a.date < b.date ? -1 : 1);
    for (const u of upcoming) {
        if (u.paid || u.autopay) continue;
        const left = Math.round((Date.parse(u.date) - Date.parse(TODAY)) / 86400000);
        if (left >= 0 && left <= 2 && HOUR >= 9 && !quiet && !sent("bill" + u.id + u.date)) { mark("bill" + u.id + u.date); await push((left === 0 ? "Bill due today: " : left === 1 ? "Bill due tomorrow: " : "Bill due in 2 days: ") + u.name, "$" + u.amount.toFixed(2) + " on " + u.date, "receipt", 3); }
        if (left <= -1 && left >= -3 && HOUR >= 9 && !quiet && !sent("billod" + u.id + u.date)) { mark("billod" + u.id + u.date); await push("Unpaid bill: " + u.name, "$" + u.amount.toFixed(2) + " was due " + (left === -1 ? "yesterday" : u.date) + " - tick it off on the fridge or phone once paid.", "warning", 4); }
    }
    const month = TODAY.slice(0, 7), spends = items("spend").filter(s => s.state === "open" && s.text).map(s => ({ id: s.id, ...HubCal.parseRec("spend", s.text) }));
    const byCat = {}; let total = 0, owe = 0;
    for (const s of spends) {
        if (s.date.slice(0, 7) === month) { byCat[s.cat || "Other"] = (byCat[s.cat || "Other"] || 0) + s.amount; total += s.amount; }
        if (s.split) owe += (s.who === "p2" ? -1 : 1) * s.amount / 2;      // + = roommate owes p1
    }
    const budgets = pc.budgets || {};
    for (const c of Object.keys(budgets)) {
        const b = +budgets[c]; if (!(b > 0)) continue;
        const pct = (byCat[c] || 0) / b;
        if (pct >= 0.9 && !sent("bud" + month + c) && !quiet) { mark("bud" + month + c); await push(c + " budget " + Math.round(pct * 100) + "% used", "$" + (byCat[c] || 0).toFixed(2) + " of $" + b.toFixed(2) + " this month.", "chart_with_upwards_trend", 3); }
    }
    const goals = items("goal").filter(g => g.state === "open" && g.text).map(g => ({ id: g.id, ...HubCal.parseRec("goal", g.text) }));
    out.money = { month, total: Math.round(total * 100) / 100, byCat, budgets, owe: Math.round(owe * 100) / 100, bills: upcoming.filter(u => u.date >= addK(TODAY, -3)).slice(0, 12), goals };

    // ---------------- pantry + packages ----------------
    const pantry = items("pantry").filter(p => p.state === "open" && p.text).map(p => ({ id: p.id, ...HubCal.parseRec("pantry", p.text) })).filter(p => p.expires);
    pantry.sort((a, b) => a.expires < b.expires ? -1 : 1);
    out.pantry = pantry.slice(0, 20);
    const soon = pantry.filter(p => p.expires <= TOMORROW && p.expires >= addK(TODAY, -2));     // 10.1.2: stop nagging every evening about food that expired days ago
    if (PC.on.remind && soon.length && HOUR >= 17 && HOUR < 21 && !sent("pantry" + TODAY)) { mark("pantry" + TODAY); await push("Use it up", soon.map(p => p.name + (p.expires < TODAY ? " (expired " + p.expires.slice(5) + ")" : p.expires === TODAY ? " (today)" : " (tomorrow)")).join("\n"), "cheese", 2); }
    out.pkgs = items("pkg").filter(p => p.state === "open" && p.text).map(p => ({ id: p.id, ...HubCal.parseRec("pkg", p.text) }));
    // 10.4: cook from the pantry - your saved recipes that use food expiring in the next 3 days, most matches first
    if (PC.on.cook) {
        const using = pantry.filter(p => p.expires <= addK(TODAY, 3)).map(p => ({ name: p.name, w: ingWord(p.name) })).filter(x => x.w.length > 2);
        if (using.length) out.cook = items("recipe").filter(r => r.state === "open" && r.text).map(r => {
            const ls = r.text.split("\n"), ing = ls.slice(1).filter(l => l.indexOf("* ") === 0).map(l => l.slice(2).toLowerCase());
            return { id: r.id, title: ls[0], uses: using.filter(x => { const re = new RegExp("\\b" + x.w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(e?s)?\\b"); return ing.some(l => re.test(l)); }).map(x => x.name) };     // 10.5: whole words ("egg" is not "eggplant")
        }).filter(r => r.uses.length).sort((a, b) => b.uses.length - a.uses.length).slice(0, 6);
    }

    // ---------------- fun: trivia, word of the day, Canucks ----------------
    if (!st.fun.day || st.fun.day !== TODAY || ((!st.fun.tday || !st.fun.wday) && due("funretry", 60))) {        // 10.1.1: a failed half is retried hourly
        st.funretryAt = NOW;
        const t = st.fun.tday === TODAY ? null : await J("https://opentdb.com/api.php?amount=5&type=multiple");
        const w = st.fun.wday === TODAY ? null : await get("https://www.merriam-webster.com/wotd/feed/rss2", 12000);
        if (t && Array.isArray(t.results) && t.results.length) st.fun.tday = TODAY;
        if (t && Array.isArray(t.results) && t.results.length) st.fun.trivia = t.results.map(q => ({ q: decodeEnts(q.question), a: decodeEnts(q.correct_answer), wrong: (q.incorrect_answers || []).map(decodeEnts), cat: decodeEnts(q.category) }));
        if (w) { const it = w.split("<item>")[1] || ""; const ti = /<title>(?:<!\[CDATA\[)?([^<\]]*)/.exec(it), de = /<itunes:summary>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/itunes:summary>|<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(it);
            if (ti) st.fun.wday = TODAY;
            if (ti) st.fun.wotd = { w: decodeEnts(ti[1]).trim(), d: decodeEnts(String((de && (de[1] || de[2])) || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 280) }; }
        st.fun.day = TODAY; if (st.fun.tday !== TODAY) st.fun.tday = ""; if (st.fun.wday !== TODAY) st.fun.wday = "";
    }
    out.trivia = st.fun.trivia || null; out.wotd = st.fun.wotd || null;
    const gameNear = ((st.nhl && st.nhl.games) || []).some(g => g.start && Date.parse(g.start) - NOW < 3 * 3600000 && NOW - Date.parse(g.start) < 4 * 3600000);
    if (due("nhl", gameNear ? 15 : 120)) {          // 10.1.1: every 15 min around a game, so the score is fresh
        const j = await J("https://api-web.nhle.com/v1/club-schedule/VAN/week/now");
        if (j && Array.isArray(j.games)) { st.nhlAt = NOW; st.nhl = { games: j.games.slice(0, 6).map(g => ({ start: g.startTimeUTC, home: g.homeTeam && g.homeTeam.abbrev, away: g.awayTeam && g.awayTeam.abbrev, hs: g.homeTeam && g.homeTeam.score, as: g.awayTeam && g.awayTeam.score, state: g.gameState })) }; }
    }
    out.nhl = (st.nhl && st.nhl.games) || [];

    // ================= 10.1.1 =================
    // Canucks standings
    if (due("nhlst", 360)) {
        st.nhlstAt = NOW;
        const j = await J("https://api-web.nhle.com/v1/standings/now");
        const v = j && Array.isArray(j.standings) ? j.standings.find(t => t.teamAbbrev && t.teamAbbrev.default === "VAN") : null;
        if (v) st.nhlst = { div: v.divisionName || "", place: v.divisionSequence || 0, league: v.leagueSequence || 0, pts: v.points || 0, w: v.wins || 0, l: v.losses || 0, otl: v.otLosses || 0, gp: v.gamesPlayed || 0 };
    }
    out.nhlst = st.nhlst || null;
    // game reminder (opt-in on the fridge: Fun > Canucks > GAME REMINDERS)
    const funCfg = (() => { const c = items("cfg").find(x => x.id === "fun" && x.text); try { const o = c ? JSON.parse(c.text) : {}; return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } })();
    if (funCfg.gamepush) for (const g of out.nhl) {
        const left = (Date.parse(g.start) - NOW) / 60000;
        if ((g.state === "FUT" || g.state === "PRE") && left > 0 && left <= 60 && !sent("game" + g.start)) { mark("game" + g.start); await push("Canucks: " + g.away + " @ " + g.home, "Puck drop in " + Math.round(left) + " min.", "ice_hockey", 2); }
    }
    // joke + fact of the day (each retried hourly until it loads)
    for (const [k, u, f] of [["joke", "https://icanhazdadjoke.com/", j => j && j.joke], ["fact", "https://uselessfacts.jsph.pl/api/v2/facts/today?language=en", j => j && j.text]]) {
        if (st.fun[k + "day"] === TODAY || !due(k, 60)) continue;
        st[k + "At"] = NOW;
        const v = f(await J(u));
        if (v) { st.fun[k] = decodeEnts(String(v)).replace(/\s+/g, " ").trim().slice(0, 300); st.fun[k + "day"] = TODAY; }
    }
    out.joke = st.fun.joke || ""; out.fact = st.fun.fact || "";
    // hot deals: NEW = first seen in the last 6 h
    st.hotSeen = st.hotSeen || {};
    const firstHot = !Object.keys(st.hotSeen).length;
    for (const h of out.hot) { const k = (h.url || h.t).slice(-60); if (!st.hotSeen[k]) st.hotSeen[k] = firstHot ? NOW - 7 * 3600000 : NOW; h.fresh = NOW - st.hotSeen[k] < 6 * 3600000; }
    for (const k of Object.keys(st.hotSeen)) if (NOW - st.hotSeen[k] > 14 * 86400000) delete st.hotSeen[k];
    // flyers: what you'd save, and the store with most of your list cheapest
    const byStore = {}; let save = 0;
    for (const f of out.flyers) { byStore[f.best.store] = (byStore[f.best.store] || 0) + 1; if (f.best.was > f.best.price) save += f.best.was - f.best.price; }
    const topStore = Object.keys(byStore).sort((a, b) => byStore[b] - byStore[a])[0];
    out.flyerSum = { save: Math.round(save * 100) / 100, store: topStore || "", n: topStore ? byStore[topStore] : 0 };
    // recipe ideas for food that's about to expire (TheMealDB) - 10.4: only when "cook from the pantry" is on
    const soonIng = PC.on.cook ? pantry.filter(p => p.expires <= addK(TODAY, 3) && !/^leftover/i.test(p.name)).map(p => p.name) : [];
    const ideaSig = soonIng.slice(0, 4).join(",");
    st.ideas = st.ideas || {};
    if (ideaSig && (st.ideas.sig !== ideaSig || due("ideas", 720))) {
        st.ideasAt = NOW; const list = []; let answered = false;
        for (const n of soonIng.slice(0, 4)) {
            const words = n.toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/).filter(Boolean);
            const tries = [words.join("_"), words[0], words[words.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i);
            for (const t of tries) {
                const j = await J("https://www.themealdb.com/api/json/v1/1/filter.php?i=" + encodeURIComponent(t));
                if (j) answered = true;
                if (j && Array.isArray(j.meals) && j.meals.length) { list.push({ for: n, meals: j.meals.slice(0, 4).map(m => ({ n: m.strMeal, id: m.idMeal })) }); break; }
            }
        }
        if (answered) st.ideas = { sig: ideaSig, list };      // 10.1.2: an outage keeps the last ideas
    }
    out.ideas = ideaSig ? (st.ideas.list || []) : [];
    // the last 7 days, for the Sunday summary
    const wk = addK(TODAY, -7), wkN = wk.replace(/-/g, ""), ch = { p1: 0, p2: 0 };
    items("chdone").forEach(c => { if (c.state === "open" && c.id.slice(-8) > wkN) ch[c.text === "p2" ? "p2" : "p1"]++; });
    // 10.10.4: out.last7, not out.week - out.week is the Almanac (the week's releases, set above). Writing the
    // Sunday summary into out.week overwrote it, so the fridge's Almanac never had any releases to show.
    out.last7 = { spent: Math.round(spends.filter(x => x.date > wk && x.cat !== "Settle-up").reduce((a, x) => a + x.amount, 0) * 100) / 100, chores: ch };
    return out;
};
