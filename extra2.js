// Kitchen Hub phone app 10.1.1: DEALS (wishlist, flyers, hot deals) and HOME (money, bills, goals, pantry,
// packages, guest Wi-Fi, home upkeep). Cloud results come from the cloud gist's extra.js (locked).
(function() {
  "use strict";
  var EX = null, EXAT = 0;
  try { EX = JSON.parse(ls.get("kh_ex") || "null"); } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function put(kind, text, id, state) { store = lockEdit(store, id || HubData.newId("p"), kind, state || "open", text); ls.set(K.store, store); render(); syncSoon(400); }
  function money(x) { return HubCal.money(x); }
  function recs(kind) { return itemsOf(kind).filter(function(i) { return i.state === "open" && !i.locked; }).map(function(i) { var o = HubCal.parseRec(kind, i.text); o.id = i.id; o.raw = i.text; return o; }); }
  function cfgJ(id) { var c = itemsOf("cfg").filter(function(i) { return i.id === id && !i.locked; })[0]; try { var o = c ? JSON.parse(c.text) : {}; return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  function cloudGist() { try { var x = JSON.parse(ls.get("kh_extras") || "null"); return x && x.brain && x.brain.cloudGist; } catch (e) { return ""; } }
  function loadEX(cb) {
    var cg = cloudGist();
    if (!cg || Date.now() - EXAT < 60000) { if (cb) cb(); return; }
    EXAT = Date.now();
    timed(cfg.api + "/gists/" + cg, { headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" }, cache: "no-store" }, 15000)
      .then(function(r) { return r.json(); }).then(function(g) {
        var f = g.files && g.files["extra.js"]; if (!f) return;
        var m = /HUB_EXTRA_LOCKED = (".*");/.exec(f.content); if (!m) return;
        var L = JSON.parse(m[1]), t = HubCrypt.unlock(L, pk());
        EX = JSON.parse(t === null ? L : t); ls.set("kh_ex", JSON.stringify(EX));
      }).catch(function() {}).then(function() { if (cb) cb(); });
  }
  function dPlus(n) { return addD(todayK(), n); }
  function daysTo(k) { var a = k.split("-"), b = todayK().split("-"); return Math.round((Date.UTC(+a[0], +a[1] - 1, +a[2]) - Date.UTC(+b[0], +b[1] - 1, +b[2])) / 86400000); }
  function bind(box) {
    [].forEach.call(box.querySelectorAll("[data-a]"), function(el) { el.addEventListener("click", function(e) { e.preventDefault(); ACT[el.getAttribute("data-a")](el.getAttribute("data-v") || "", el); }); });
  }
  function b(a, v, label, cls) { return '<button class="btn ' + (cls || "ghost") + ' sm" data-a="' + a + '" data-v="' + esc(v) + '">' + label + "</button>"; }
  var CATS = ["Groceries", "Eating out", "Gas", "Household", "Bills", "Fun", "Other"];
  var MOFF = 0;      // 10.1.1: which month the money card shows (0 = this month)
  function monthAgo(n) { var y = +todayK().slice(0, 4), m = +todayK().slice(5, 7) - 1 - n; while (m < 0) { m += 12; y--; } return y + "-" + ("0" + (m + 1)).slice(-2); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function saleCountdown() {
    var n = new Date(Date.now() - 8 * 3600000), y = n.getUTCFullYear(), m = n.getUTCMonth(), d = n.getUTCDate(), f = new Date(Date.UTC(y, 10, 1)).getUTCDay(), thu = 1 + (4 - f + 7) % 7 + 21;
    if (m === 10 && d >= thu && d <= thu + 4) return "Black Friday is on";
    if ((m === 11 && d >= 26) || (m === 0 && d <= 1)) return "Boxing Week is on";
    if (m === 10 && d < thu + 1) return plural(thu + 1 - d, "day") + " to Black Friday";
    if (m === 11) return plural(26 - d, "day") + " to Boxing Day";
    return "";
  }
  var QUICK = [["Milk", 7], ["Chicken", 2], ["Ground beef", 2], ["Bread", 5, "pantry"], ["Eggs", 21], ["Yogurt", 10], ["Deli meat", 4], ["Salad greens", 4], ["Freezer meat", 90, "freezer"]];
  function track(c, t) {
    if (!t) return "";
    var u = /canada post/i.test(c) ? "https://www.canadapost-postescanada.ca/track-reperage/en#/details/" : /purolator/i.test(c) ? "https://www.purolator.com/en/shipping/tracker?pin=" : /ups/i.test(c) ? "https://www.ups.com/track?tracknum=" : /fedex/i.test(c) ? "https://www.fedex.com/fedextrack/?trknbr=" : /amazon/i.test(c) ? "" : "https://parcelsapp.com/en/tracking/";
    return u ? ' <a class="btn sm" target="_blank" href="' + esc(u + encodeURIComponent(t)) + '">Track</a>' : ' <span class="sub">#' + esc(t) + "</span>";
  }

  // ---------- DEALS ----------
  function renderDeals() {
    var box = $("app-d"), ws = recs("wish"), ex = (EX && EX.wish) || [], m = {}, h = "", cd = saleCountdown();
    ex.forEach(function(e) { m[e.id] = e; });
    function pct(e) { return e.reg > e.price && e.price ? Math.round((1 - e.price / e.reg) * 100) : 0; }
    function lowest(e) { var hs = e.hist || []; return !!(e.price && hs.length > 1 && e.price <= e.low && e.price < Math.max.apply(null, hs)); }
    ws.sort(function(a, c) { var A = m[a.id] || {}, C = m[c.id] || {}; return ((C.hit ? 1000 : 0) + (lowest(C) ? 200 : 0) + pct(C)) - ((A.hit ? 1000 : 0) + (lowest(A) ? 200 : 0) + pct(A)); });
    if (cd) h += '<div class="card"><b>' + esc(cd) + "</b></div>";
    h += '<h2>Watching (Best Buy)</h2><div class="row"><input id="dw-n" placeholder="Ninja air fryer, 55&quot; TV, AirPods…" style="flex:2"><input id="dw-t" type="number" inputmode="decimal" placeholder="my $" style="flex:1"><button class="btn" data-a="wishAdd">Watch</button></div><ul class="xl">';
    if (!ws.length) h += '<li class="empty">Nothing watched yet. Your phone gets a push when the price drops to yours.</li>';
    ws.forEach(function(w) {
      var e = m[w.id] || {};
      h += '<li><div><b>' + esc(w.name) + '</b>' + (e.hit ? ' <span class="tg">TARGET HIT</span>' : "") + (lowest(e) ? ' <span class="tg">LOWEST</span>' : "") + (e.clear ? ' <span class="tg o">CLEARANCE</span>' : "") + (pct(e) >= 5 ? ' <span class="tg o">−' + pct(e) + '%</span>' : e.sale && !e.hit ? ' <span class="tg o">SALE</span>' : "") + '<div class="sub">' +
        (e.price ? "<b>" + money(e.price) + "</b>" + (e.reg > e.price ? " <s>" + money(e.reg) + "</s>" : "") + " · lowest " + money(e.low) + (w.target ? " · yours " + money(w.target) : "") + (e.ends ? " · ends " + esc(String(e.ends).slice(5, 10)) : "") : "Price after the next cloud run") +
        (e.title ? "<br>" + esc(e.title) : "") + '</div><div class="row">' + (e.url ? '<a class="btn sm" href="' + esc(e.url) + '" target="_blank">Best Buy</a>' : "") + b("wishT", w.id, "My price") + b("del", "wish:" + w.id, "Stop") + "</div></div></li>";
    });
    h += '</ul><h2>Your list in this week’s flyers (V2N)</h2><ul class="xl">';
    var fl = (EX && EX.flyers) || [], fs = EX && EX.flyerSum;
    if (fs && (fs.save > 0 || fs.n > 1)) h += '<li><div>' + (fs.save > 0 ? "Save about <b>" + money(fs.save) + "</b> buying the sale prices. " : "") + (fs.n > 1 ? "<b>" + esc(fs.store) + "</b> has " + fs.n + " of your items cheapest." : "") + "</div></li>";
    if (!fl.length) h += '<li class="empty">Nothing on your list is in the flyers right now.</li>';
    fl.forEach(function(f) { h += '<li><div><b>' + esc(f.name) + '</b> — <b>' + money(f.best.price) + '</b> ' + esc(f.best.unit || "") + ' at ' + esc(f.best.store) + '<div class="sub">' + esc(f.best.item) + (f.best.was ? " · was " + money(f.best.was) : "") + (f.best.to ? " · until " + esc(f.best.to.slice(5)) : "") + (f.more && f.more.length ? "<br>also " + f.more.map(function(x) { return money(x.price) + " " + esc(x.store); }).join(", ") : "") + "</div></div></li>"; });
    h += '</ul><h2>Hot deals (RedFlagDeals)</h2><ul class="xl">';
    var hot = (EX && EX.hot) || [];
    if (!hot.length) h += '<li class="empty">Arrives with the next cloud run.</li>';
    hot.forEach(function(x) { h += '<li><div><span class="tg o">+' + x.score + '</span> ' + (x.fresh ? '<span class="tg">NEW</span> ' : "") + (x.url ? '<a href="' + esc(x.url) + '" target="_blank">' + esc(x.t) + "</a>" : esc(x.t)) + (x.store || x.price ? '<div class="sub">' + esc(x.store) + (x.price ? " · " + esc(x.price) : "") + "</div>" : "") + "</div></li>"; });
    h += "</ul>" + (EX && EX.ts ? '<p class="sub">Checked ' + Math.max(0, Math.round((Date.now() / 1000 - EX.ts) / 60)) + " min ago.</p>" : "");
    box.innerHTML = h; bind(box);
  }

  // ---------- HOME ----------
  function moneyNow() {
    var month = monthAgo(MOFF), byCat = {}, total = 0, owe = 0, per = { p1: 0, p2: 0 }, last = 0, lm = monthAgo(MOFF + 1);
    recs("spend").forEach(function(s) { if (s.split) owe += (s.who === "p2" ? -1 : 1) * s.amount / 2; if (s.cat === "Settle-up" || !s.date) return; if (s.date.slice(0, 7) === month) { byCat[s.cat] = (byCat[s.cat] || 0) + s.amount; total += s.amount; per[s.who === "p2" ? "p2" : "p1"] += s.amount; } if (s.date.slice(0, 7) === lm) last += s.amount; });
    var paid = {}; itemsOf("billpd").forEach(function(p) { if (p.state === "open") paid[p.id] = 1; });
    var up = [];
    recs("bill").forEach(function(bl) { var r = HubCal.parseRepeat(bl.rule + "||" + bl.name + "|"); if (!r) return; for (var d = -5; d <= 35; d++) { var k = dPlus(d); if (HubCal.repeatOn(r, k)) up.push({ id: bl.id, name: bl.name, amount: bl.amount, date: k, autopay: bl.autopay, paid: !!paid["bp" + bl.id + k.replace(/-/g, "")] }); } });
    up.sort(function(a, c) { return a.date < c.date ? -1 : 1; });
    return { month: month, total: total, byCat: byCat, per: per, last: last, owe: Math.round(owe * 100) / 100, bills: up, budgets: cfgJ("money").budgets || {} };
  }
  function renderHome() {
    loadPeople();
    var box = $("app-h"), M = moneyNow(), h = "", two = hasP2(), tk = todayK(), done = {}, sc = { p1: 0, p2: 0 }, mk = tk.slice(0, 7).replace("-", "");
    itemsOf("chdone").forEach(function(c) { if (c.state === "open" && !c.locked) { done[c.id] = c.text || "p1"; if (c.id.slice(-8, -2) === mk) sc[c.text === "p2" ? "p2" : "p1"]++; } });
    var todays = itemsOf("repeat").filter(function(r) { return r.state === "open" && !r.locked; }).map(function(r) { var p = HubCal.parseRepeat(r.text); if (p) p.id = r.id; return p; }).filter(function(p) { return p && HubCal.repeatOn(p, tk); });
    if (todays.length || sc.p1 + sc.p2) {
      h += "<h2>Chores today</h2><ul class=\"xl\">";
      todays.forEach(function(r) { var id = "cd" + r.id + tk.replace(/-/g, ""), who = r.who === "rot" ? HubCal.rotWho(tk) : r.who; h += "<li><div><b>" + esc(r.title) + "</b>" + (who && two ? " · " + esc(pName(who)) : "") + (done[id] ? ' <span class="tg o">✓ ' + (two ? esc(pName(done[id])) : "done") + "</span>" : '<div class="row">' + b("chd", r.id + "|p1", two ? "✓ " + esc(pName("p1")) : "✓ Done") + (two ? b("chd", r.id + "|p2", "✓ " + esc(pName("p2"))) : "") + "</div>") + "</div></li>"; });
      h += "</ul>" + (two ? '<p class="sub">Done in ' + MON[+tk.slice(5, 7) - 1] + ": " + esc(pName("p1")) + " " + sc.p1 + " · " + esc(pName("p2")) + " " + sc.p2 + "</p>" : "");
    }
    h += '<h2>' + b("mo", "1", "‹") + ' Money · ' + MON[+M.month.slice(5, 7) - 1] + " " + (MOFF ? M.month.slice(0, 4) + " " + b("mo", "-1", "›") : "") + '</h2><div class="card"><b class="big">' + money(M.total) + '</b> spent' + (MOFF ? "" : " this month") +
      (two && (M.per.p1 || M.per.p2) ? '<div class="sub">' + esc(pName("p1")) + " " + money(M.per.p1) + " · " + esc(pName("p2")) + " " + money(M.per.p2) + "</div>" : "") +
      (M.last ? '<div class="sub">' + MON[+monthAgo(MOFF + 1).slice(5, 7) - 1] + " was " + money(M.last) + "</div>" : "") +
      (two && M.owe ? '<div style="margin-top:6px">' + (M.owe > 0 ? esc(pName("p2")) + " owes " + esc(pName("p1")) : esc(pName("p1")) + " owes " + esc(pName("p2"))) + " <b>" + money(Math.abs(M.owe)) + "</b> " + b("settle", "", "Settle up") + "</div>" : "") + "</div>";
    h += '<div class="row" style="margin-top:8px"><input id="hs-a" type="number" inputmode="decimal" placeholder="$ amount" style="flex:1"><select id="hs-c" style="flex:1">' + CATS.map(function(c) { return "<option>" + c + "</option>"; }).join("") + "</select></div>" +
      '<div class="row"><input id="hs-n" placeholder="note (optional)" style="flex:2">' + (two ? '<select id="hs-w" style="flex:1"><option value="p1|1">' + esc(pName("p1")) + ' paid · split</option><option value="p2|1">' + esc(pName("p2")) + ' paid · split</option><option value="' + me() + '|0">just me</option></select>' : "") + '<button class="btn" data-a="spend">Log</button></div><ul class="xl">';
    CATS.concat(Object.keys(M.byCat).filter(function(c) { return CATS.indexOf(c) < 0; })).forEach(function(c) {
      var sp = M.byCat[c] || 0, bu = +M.budgets[c] || 0; if (!sp && !bu) return;
      h += '<li><div><b>' + esc(c) + "</b> " + money(sp) + (bu ? " of " + money(bu) + (sp > bu ? ' <span class="tg">OVER</span>' : "") + '<div class="bar"><i style="width:' + Math.min(100, Math.round(sp / bu * 100)) + '%"></i></div>' : "") + "</div></li>";
    });
    h += '</ul><p class="row">' + b("budget", "", "Set a budget") + b("csv", "", "Export CSV") + "</p>";
    h += '<h2>Bills</h2><div class="row"><input id="hb-n" placeholder="Rent, Hydro…" style="flex:2"><input id="hb-a" type="number" inputmode="decimal" placeholder="$" style="flex:1"><input id="hb-d" type="number" placeholder="day" style="flex:1" min="1" max="31"></div><div class="row"><label style="font-size:15px"><input type="checkbox" id="hb-ap"> autopay</label><button class="btn" data-a="bill">Add bill</button></div><ul class="xl">';
    var seen = {};
    M.bills.forEach(function(x) {
      var d = daysTo(x.date); if ((x.paid && d < 0) || seen[x.id] >= 2) return; seen[x.id] = (seen[x.id] || 0) + 1;
      h += '<li><div><b>' + esc(x.name) + "</b> " + money(x.amount) + " · " + dayLabel(x.date) + " " + (x.paid ? '<span class="tg o">PAID</span>' : x.autopay ? '<span class="tg o">AUTOPAY</span>' : d < 0 ? '<span class="tg">OVERDUE</span>' : d <= 2 ? '<span class="tg">SOON</span>' : "") + '<div class="row">' + (x.paid || x.autopay ? "" : b("paid", x.id + "|" + x.date, "✓ Paid")) + b("del", "bill:" + x.id, "Remove") + "</div></div></li>";
    });
    h += "</ul><h2>Savings goals</h2>";
    recs("goal").forEach(function(g) { var p = g.target ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0, nd = g.by && g.target > g.saved ? (daysTo(g.by) < 0 ? " · date passed" : " · " + money((g.target - g.saved) / Math.max(1, daysTo(g.by) / 7)) + "/week to make it by " + dayLabel(g.by)) : ""; h += '<div class="card"><b>' + esc(g.name) + "</b> " + money(g.saved) + " of " + money(g.target) + " · " + p + "%" + (nd ? '<div class="sub">' + nd.slice(3) + "</div>" : "") + '<div class="bar"><i style="width:' + p + '%"></i></div><div class="row">' + b("goal", g.id + "|25", "+$25") + b("goal", g.id + "|100", "+$100") + b("goal", g.id + "|x", "Other…") + b("del", "goal:" + g.id, "Remove") + "</div></div>"; });
    h += '<div class="row"><input id="hg-n" placeholder="Saving for…" style="flex:2"><input id="hg-t" type="number" placeholder="$ goal" style="flex:1"><input id="hg-d" type="date" style="flex:1" title="by (optional)"><button class="btn ghost" data-a="goalAdd">Add</button></div>';
    h += '<h2>Pantry & leftovers</h2><div class="row"><input id="hp-n" placeholder="Chicken, milk, leftovers…" style="flex:2"><select id="hp-d" style="flex:1"><option value="1">tomorrow</option><option value="2">2 days</option><option value="3" selected>3 days</option><option value="5">5 days</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option><option value="90">3 months</option></select><button class="btn" data-a="pantry">Add</button></div><div class="row" style="flex-wrap:wrap">' + QUICK.map(function(q, i) { return b("pq", String(i), "+ " + q[0]); }).join("") + '</div><ul class="xl">';
    recs("pantry").sort(function(a, c) { return a.expires < c.expires ? -1 : 1; }).forEach(function(p) { var d = p.expires ? daysTo(p.expires) : 99; h += '<li><div><b>' + esc(p.name) + "</b> · " + (d < 0 ? '<span class="tg">EXPIRED</span>' : d <= 1 ? '<span class="tg">' + (d === 0 ? "TODAY" : "TOMORROW") + "</span>" : d + " days") + '<div class="row">' + b("used", p.id, "✓ Used") + b("tossed", p.id, "Tossed") + b("relist", p.id, "Buy again") + "</div></div></li>"; });
    var ideas = (EX && EX.ideas) || [];
    if (ideas.length) h += '</ul><h3>Use it up: dinner ideas</h3><ul class="xl">' + ideas.map(function(x) { return "<li><div><b>" + esc(x.for) + "</b>: " + x.meals.map(function(m) { return '<a target="_blank" href="https://www.themealdb.com/meal/' + esc(m.id) + '">' + esc(m.n) + "</a>"; }).join(", ") + "</div></li>"; }).join("");
    var wst = cfgJ("waste"); if (wst[todayK().slice(0, 7)] || wst[monthAgo(1)]) h += '</ul><p class="sub">Thrown out: ' + (wst[todayK().slice(0, 7)] || 0) + " this month, " + (wst[monthAgo(1)] || 0) + " last month.</p><ul class=\"xl\">";
    h += '</ul><h2>Packages</h2><div class="row"><input id="hk-n" placeholder="What’s coming" style="flex:2"><input id="hk-d" type="date" style="flex:1"></div><div class="row"><select id="hk-c" style="flex:1"><option value="">carrier?</option><option>Canada Post</option><option>Purolator</option><option>UPS</option><option>FedEx</option><option>Amazon</option></select><input id="hk-t" placeholder="tracking # (optional)" style="flex:2"><button class="btn" data-a="pkg">Add</button></div><ul class="xl">';
    recs("pkg").forEach(function(p) { var late = p.expected && daysTo(p.expected) < 0; h += '<li><div><b>' + esc(p.name) + "</b> · " + (p.expected ? dayLabel(p.expected) : "") + (late ? ' <span class="tg">LATE</span>' : "") + (p.carrier ? ' <span class="sub">' + esc(p.carrier) + "</span>" : "") + track(p.carrier, p.tracking) + " " + b("got", p.id, "✓ Got it") + "</div></li>"; });
    var wf = cfgJ("wifi");
    h += '</ul><h2>Guest Wi-Fi</h2><div class="row"><input id="hw-s" placeholder="network" value="' + esc(wf.ssid || "") + '" style="flex:1"><input id="hw-p" placeholder="password" value="' + esc(wf.pass || "") + '" style="flex:1"><button class="btn ghost" data-a="wifi">Save</button></div><p class="sub">Shows as a scan-to-join code on the fridge (APPS › Home › Guest Wi-Fi).</p>';
    h += '<h2>Home upkeep reminders</h2><div class="row" style="flex-wrap:wrap">' + UP.map(function(u, i) { return b("upkeep", String(i), "+ " + u[0]); }).join("") + "</div>";
    box.innerHTML = h; bind(box);
    if ($("hp-d")) $("hp-d").value = "3";
    if ($("hk-d")) $("hk-d").value = dPlus(3);
  }
  var UP = [["Furnace filter", "months:3"], ["Test smoke alarms", "months:1"], ["Fridge water filter", "months:6"], ["Clean fridge coils", "months:6"], ["Dryer vent", "months:12"], ["Clean the oven", "months:3"]];
  function val(id) { return ($(id) && $(id).value || "").trim(); }
  var ACT = {
    del: function(v) { var p = v.split(":"), it = itemsOf(p[0]).filter(function(i) { return i.id === p[1]; })[0]; if (it && confirm("Remove?")) put(p[0], it.text, it.id, "del"); },
    wishAdd: function() { var n = val("dw-n"); if (!n) return; put("wish", HubCal.recText("wish", { name: n, target: +val("dw-t") || 0, query: n })); },
    wishT: function(id) { var w = recs("wish").filter(function(x) { return x.id === id; })[0]; if (!w) return; var t = prompt("Your price for " + w.name, w.target || ""); if (t !== null) { w.target = +t || 0; put("wish", HubCal.recText("wish", w), id); } },
    spend: function() { var a = +val("hs-a"); if (!(a > 0)) return; var w = $("hs-w") ? $("hs-w").value.split("|") : [me(), "0"]; put("spend", HubCal.recText("spend", { date: todayK(), amount: a, cat: $("hs-c").value, who: w[0], split: w[1] === "1", note: val("hs-n") })); },
    settle: function() { var M = moneyNow(); if (M.owe && confirm("Mark " + money(Math.abs(M.owe)) + " as settled?")) put("spend", HubCal.recText("spend", { date: todayK(), amount: Math.abs(M.owe) * 2, cat: "Settle-up", who: M.owe > 0 ? "p2" : "p1", split: true, note: "settled up" })); },
    budget: function() { var c = prompt("Budget for which category?\n" + CATS.join(", "), "Groceries"); if (!c) return; c = c.trim(); CATS.forEach(function(x) { if (x.toLowerCase() === c.toLowerCase()) c = x; }); var v = prompt("Monthly budget for " + c + " ($, 0 = none)"); if (v === null) return; var m = cfgJ("money"); m.budgets = m.budgets || {}; if (+v > 0) m.budgets[c] = +v; else delete m.budgets[c]; put("cfg", JSON.stringify(m), "money"); },
    bill: function() { var n = val("hb-n"); if (!n) return; put("bill", HubCal.recText("bill", { name: n, amount: +val("hb-a") || 0, rule: "monthly:" + Math.max(1, Math.min(31, +val("hb-d") || 1)), who: "", autopay: $("hb-ap").checked })); },
    paid: function(v) { var p = v.split("|"); put("billpd", p[1], "bp" + p[0] + p[1].replace(/-/g, "")); },
    goal: function(v) { var p = v.split("|"), g = recs("goal").filter(function(x) { return x.id === p[0]; })[0]; var n = p[1] === "x" ? +prompt("Add how much? (minus to take out)") : +p[1]; if (n) { g.saved = Math.round((g.saved + n) * 100) / 100; put("goal", HubCal.recText("goal", g), g.id); } },
    goalAdd: function() { var n = val("hg-n"); if (n) put("goal", HubCal.recText("goal", { name: n, target: +val("hg-t") || 0, saved: 0, by: val("hg-d") })); },
    mo: function(v) { MOFF = Math.max(0, MOFF + +v); renderHome(); },
    csv: function() {
      var rows = [["date", "amount", "category", "who", "split", "note"]].concat(recs("spend").sort(function(a, c) { return a.date < c.date ? -1 : 1; }).map(function(s) { return [s.date, s.amount.toFixed(2), s.cat, pName(s.who === "p2" ? "p2" : "p1"), s.split ? "yes" : "no", s.note]; }));
      var t = rows.map(function(r) { return r.map(function(x) { x = String(x == null ? "" : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(","); }).join("\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv" })); a.download = "kitchen-hub-spending-" + todayK() + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function() { a.remove(); }, 500);
    },
    pq: function(i) { var q = QUICK[+i]; put("pantry", HubCal.recText("pantry", { name: q[0], expires: dPlus(q[1]), qty: 1, where: q[2] || "fridge" })); },
    tossed: function(id) { var it = itemsOf("pantry").filter(function(i) { return i.id === id; })[0]; if (!it) return; var w = cfgJ("waste"), k = todayK().slice(0, 7); w[k] = (+w[k] || 0) + 1; store = lockEdit(store, "waste", "cfg", "open", JSON.stringify(w)); put("pantry", it.text, id, "done"); },
    chd: function(v) { var p = v.split("|"); put("chdone", p[1], "cd" + p[0] + todayK().replace(/-/g, "")); },
    pantry: function() { var n = val("hp-n"); if (n) put("pantry", HubCal.recText("pantry", { name: n, expires: dPlus(+$("hp-d").value), qty: 1, where: "fridge" })); },
    used: function(id) { var it = itemsOf("pantry").filter(function(i) { return i.id === id; })[0]; if (it) put("pantry", it.text, id, "done"); },
    relist: function(id) { var p = recs("pantry").filter(function(x) { return x.id === id; })[0]; if (p) put("shop", hasP2() ? HubCal.shopText(p.name.replace(/^leftovers:\s*/i, ""), me(), 1, "") : p.name.replace(/^leftovers:\s*/i, "")); },
    pkg: function() { var n = val("hk-n"); if (n) put("pkg", HubCal.recText("pkg", { name: n, carrier: $("hk-c") ? $("hk-c").value : "", tracking: val("hk-t").replace(/\s/g, ""), expected: val("hk-d") })); },
    got: function(id) { var it = itemsOf("pkg").filter(function(i) { return i.id === id; })[0]; if (it) put("pkg", it.text, id, "done"); },
    wifi: function() { put("cfg", JSON.stringify({ ssid: val("hw-s"), pass: val("hw-p"), sec: val("hw-p") ? "WPA" : "nopass" }), "wifi"); },
    upkeep: function(i) { var u = UP[+i]; put("repeat", HubCal.repeatText(u[1] + ":" + todayK(), "", u[0], "", "")); }
  };
  window.renderDeals = function() { renderDeals(); loadEX(function() { if (TAB === "deals") renderDeals(); }); };
  window.renderHome = renderHome;
  render();
})();
