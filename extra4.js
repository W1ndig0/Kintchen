// Kitchen Hub phone app 10.8: polish.
//  - Tabs: a bar at the bottom (thumb reach) with LIST, CALENDAR, DEALS, FRIDGE and MORE; MORE opens the rest
//    (recipes, board, pantry, home, books). The old strip of nine tabs, most of them off screen, is hidden
//    but still there: the bottom bar just taps it, so every tab works exactly as before.
//  - A shorter header: the name and the sync status on one line.
//  - DEALS starts with the deals the cloud found for you (photo, sale price, regular price crossed out, % off,
//    and why), the same list the fridge shows.
//  - Adding a shift: tap a start, the minutes and a length instead of typing "9:15-3:15p".
//  - Forms wrap on narrow phones instead of squeezing their boxes until the hints are cut off.
// Uses the globals of index.html (TAB, render, calData, todayK, addD, ...).
(function() {
  "use strict";
  var MAIN = [["list", "List", "M4 6h16M4 12h16M4 18h10"], ["cal", "Calendar", "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5"],
              ["deals", "Deals", "M3 12l9-9h8v8l-9 9zM15.5 7.5h.01"], ["fridge", "Fridge", "M6 3h12v18H6zM6 10h12M9 6v2M9 13v3"]];
  var MORE_IC = "M5 12h.01M12 12h.01M19 12h.01";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function svg(d) { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

  var css = document.createElement("style");
  css.textContent = [
    "header { padding: calc(env(safe-area-inset-top) + 8px) 16px 8px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }",
    "header h1 { font-size: 17px; letter-spacing: .16em; }",
    "header #status { margin: 0; font-size: 11px; text-align: right; }",
    "header #tabs { display: none !important; }",
    "#nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; background: var(--paper); border-top: 2px solid var(--ink); padding-bottom: env(safe-area-inset-bottom); }",
    "#nav a { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 2px 7px; font: 800 10px/1 -apple-system, Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--ink); text-decoration: none; }",
    "#nav a.sel { background: var(--ink); color: #fff; }",
    "#more { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; background: var(--paper); border-top: 3px solid var(--ink); padding: 14px 16px calc(env(safe-area-inset-bottom) + 76px); box-shadow: 0 -8px 0 rgba(0,0,0,.08); }",
    "#more h2 { margin: 0 0 10px; }",
    "#more .g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }",
    "#more .g a { border: 2px solid var(--ink); padding: 14px 6px; text-align: center; font: 800 12px/1.2 -apple-system, Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--ink); text-decoration: none; background: #fff; }",
    "#more .g a.sel { background: var(--ink); color: #fff; }",
    "#more-dim { position: fixed; inset: 0; z-index: 5; background: rgba(0,0,0,.25); }",
    "main { padding-bottom: 150px !important; }",
    "form#add { bottom: calc(env(safe-area-inset-bottom) + 58px); padding-bottom: 10px; }",
    "main h2:first-child { margin-top: 16px; }",
    // forms: wrap instead of squeezing
    "main .row { flex-wrap: wrap; }",
    "main .row > input:not([type=checkbox]):not([type=radio]), main .row > select { flex: 1 1 7.5em !important; min-width: 0; }",
    "main .row > label { flex: 1 1 9em !important; }",
    "main .row > .btn { flex: none; }",
    "input, select, textarea { border-radius: 0; }",
    "main input::placeholder { color: #999; }",
    // deal cards
    ".dl4 { display: flex; gap: 12px; align-items: center; border: 2px solid var(--ink); background: #fff; padding: 10px; margin: 8px 0; color: var(--ink); text-decoration: none; }",
    ".dl4 .im { flex: none; width: 76px; height: 76px; display: grid; place-items: center; border: 1px solid var(--rule); background: #fff; overflow: hidden; }",
    ".dl4 .im img { max-width: 100%; max-height: 100%; }",
    ".dl4 .im span { font: 900 22px Georgia, serif; }",
    ".dl4 .tx { flex: 1; min-width: 0; }",
    ".dl4 .t { font-size: 15px; line-height: 1.25; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".dl4 .p { margin-top: 4px; font: 900 20px/1 Georgia, serif; }",
    ".dl4 .p s { font: 400 13px -apple-system, Arial, sans-serif; color: var(--mute); margin-left: 6px; }",
    ".dl4 .p .off { font: 800 12px/18px -apple-system, Arial, sans-serif; background: var(--ink); color: #fff; padding: 0 6px; margin-left: 6px; vertical-align: 3px; }",
    ".dl4 .w { font-size: 12px; color: var(--mute); margin-top: 4px; letter-spacing: .02em; }",
    // shift picker
    "#c-pick { margin: 4px 0 8px; }",
    "#c-pick .k { font: 800 11px/1 -apple-system, Arial, sans-serif; letter-spacing: .14em; color: var(--mute); margin: 10px 0 4px; }",
    "#c-pick .cs { display: flex; flex-wrap: wrap; gap: 6px; }",
    "#c-pick .cs span { border: 2px solid var(--ink); padding: 8px 9px; min-width: 40px; text-align: center; font: 800 13px/1 -apple-system, Arial, sans-serif; background: #fff; cursor: pointer; }",
    "#c-pick .cs span.sel { background: var(--ink); color: #fff; }"
  ].join("\n");
  document.head.appendChild(css);

  // ---------- bottom bar ----------
  function spans() { return [].slice.call(document.querySelectorAll("#tabs span")); }
  function moreTabs() { var m = MAIN.map(function(x) { return x[0]; }); return spans().filter(function(s) { return m.indexOf(s.getAttribute("data-tab")) < 0; }); }
  function go(name) {
    var s = document.querySelector('#tabs span[data-tab="' + name + '"]');
    closeMore();
    if (s) s.click();
    window.scrollTo(0, 0);
    paint();
  }
  var nav = document.createElement("nav"); nav.id = "nav";
  function paint() {
    var t = window.TAB, inMore = moreTabs().some(function(s) { return s.getAttribute("data-tab") === t; });
    var cur = inMore ? moreTabs().filter(function(s) { return s.getAttribute("data-tab") === t; })[0] : null;
    var h = MAIN.map(function(x) { return '<a href="#" data-go="' + x[0] + '"' + (t === x[0] ? ' class="sel"' : "") + ">" + svg(x[2]) + x[1] + "</a>"; }).join("");
    h += '<a href="#" data-go="_more"' + (inMore ? ' class="sel"' : "") + ">" + svg(MORE_IC) + (cur ? esc(cur.textContent.toLowerCase()) : "More") + "</a>";
    if (nav.__h !== h) { nav.__h = h; nav.innerHTML = h; }
    nav.hidden = !window.cfg;
  }
  nav.addEventListener("click", function(e) {
    var a = e.target.closest && e.target.closest("a[data-go]");
    if (!a) return;
    e.preventDefault();
    var g = a.getAttribute("data-go");
    if (g === "_more") { if ($("more")) closeMore(); else openMore(); } else go(g);
  });
  function openMore() {
    var dim = document.createElement("div"); dim.id = "more-dim"; dim.addEventListener("click", closeMore);
    var m = document.createElement("div"); m.id = "more";
    m.innerHTML = "<h2>More</h2><div class='g'>" + moreTabs().map(function(s) {
      var n = s.getAttribute("data-tab");
      return '<a href="#" data-go="' + n + '"' + (window.TAB === n ? ' class="sel"' : "") + ">" + esc(s.textContent) + "</a>";
    }).join("") + "</div>";
    m.addEventListener("click", function(e) { var a = e.target.closest && e.target.closest("a[data-go]"); if (a) { e.preventDefault(); go(a.getAttribute("data-go")); } });
    document.body.appendChild(dim); document.body.appendChild(m);
  }
  function closeMore() { ["more", "more-dim"].forEach(function(id) { var e = $(id); if (e) e.parentNode.removeChild(e); }); }
  document.body.appendChild(nav);
  // keep the bar in step when something else changes the tab (a link inside a tab, the pairing screen)
  var __render = window.render;
  window.render = function() { __render.apply(this, arguments); paint(); };
  paint();

  // ---------- deals for you ----------
  function exNow() { try { return JSON.parse(ls.get("kh_ex") || "null"); } catch (e) { return null; } }
  function why(d) {
    if (d.kind === "wish") return "On your wishlist";
    if (d.kind === "target") return "At your price";
    if (d.kind === "sim" || d.kind === "like") return d["for"] ? "Like your " + esc(d["for"]) : "Like something you watch";
    if (d.kind === "fill") return "Also on sale";
    return d.store ? esc(d.store) : "";
  }
  function dealCards() {
    var ex = exNow(), ds = (ex && ex.deals) || [];
    if (!ds.length) return "";
    var h = "<h2>Deals for you</h2>";
    ds.slice(0, 12).forEach(function(d) {
      if (!d || !d.title) return;
      var img = /^https:\/\/[^\s"'<>]+$/.test(String(d.src || "")) ? '<img src="' + esc(d.src) + '" alt="" loading="lazy">' : "<span>$</span>";
      var off = d.off > 0 ? '<span class="off">&minus;' + Math.round(d.off) + "%</span>" : "";
      var tag = /^https:\/\/www\.bestbuy\.ca\//.test(String(d.url || "")) ? "a" : "div";
      h += "<" + tag + ' class="dl4"' + (tag === "a" ? ' href="' + esc(d.url) + '" target="_blank" rel="noopener"' : "") + '><span class="im">' + img + '</span><span class="tx"><span class="t">' + esc(d.title) + "</span>" +
           '<div class="p">' + HubCal.money(+d.price || 0) + (d.reg > d.price ? "<s>" + HubCal.money(+d.reg) + "</s>" : "") + off + "</div>" +
           '<div class="w">' + why(d) + (d.ends ? " &middot; ends " + esc(String(d.ends).slice(5, 10)) : "") + "</div></span></" + tag + ">";
    });
    return h;
  }
  // the tab redraws itself when the cloud's list arrives (without going through window.renderDeals), so the cards
  // are put back whenever the tab's content is replaced
  function addCards() {
    var box = $("app-d");
    if (!box || box.hidden) return;
    var h = dealCards(), old = $("dl4-box");
    if (old && old.__h === h && old.parentNode === box && box.firstChild === old) return;
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!h) return;
    var d = document.createElement("div"); d.id = "dl4-box"; d.innerHTML = h; d.__h = h;
    box.insertBefore(d, box.firstChild);
  }
  if ($("app-d") && window.MutationObserver) new MutationObserver(function() { addCards(); }).observe($("app-d"), { childList: true });
  var __deals = window.renderDeals;
  if (__deals) window.renderDeals = function() { __deals.apply(this, arguments); addCards(); };

  // ---------- shift picker ----------
  var P = { s: null, m: 0 };
  function hhmm(min) { min = ((min % 1440) + 1440) % 1440; var h = Math.floor(min / 60), m = min % 60; return (h < 10 ? "0" : "") + h + (m ? ":" + (m < 10 ? "0" : "") + m : ""); }
  function shiftStr(s, e) { var a = hhmm(s), b = hhmm(e); if (a.indexOf(":") < 0 && b.indexOf(":") >= 0) a += ":00"; if (b.indexOf(":") < 0 && a.indexOf(":") >= 0) b += ":00"; return a + "-" + b; }
  function lbl(h) { h = ((h % 24) + 24) % 24; return (h % 12 || 12) + (h < 12 ? "a" : "p"); }
  function pickHtml() {
    var h = "<div class='k'>STARTS</div><div class='cs'>", i, hrs = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
    hrs.forEach(function(x) { h += "<span data-ps='" + x * 60 + "'" + (P.s === x * 60 ? " class='sel'" : "") + ">" + lbl(x) + "</span>"; });
    h += "</div><div class='cs' style='margin-top:6px'>";
    [0, 15, 30, 45].forEach(function(m) { h += "<span data-pm='" + m + "'" + (P.m === m ? " class='sel'" : "") + ">:" + (m < 10 ? "0" : "") + m + "</span>"; });
    h += "</div>";
    if (P.s !== null) {
      var st = P.s + P.m;
      h += "<div class='k'>HOW LONG</div><div class='cs'>";
      [4, 6, 7.5, 8, 8.5, 9, 10, 12].forEach(function(l) { var e = st + l * 60; h += "<span data-pl='" + l * 60 + "'>" + l + "h &rarr; " + lbl(Math.floor(e / 60)).replace(/([ap])$/, (e % 60 ? ":" + ("0" + e % 60).slice(-2) : "") + "$1") + "</span>"; });
      h += "</div>";
    }
    var last = lastWeek();
    h += "<div class='cs' style='margin-top:10px'><span data-po='OFF'>OFF</span>" + (last ? "<span data-po='" + esc(last) + "'>Same as last week (" + esc(last) + ")</span>" : "") + "</div>";
    return h;
  }
  function lastWeek() {
    var d = $("c-date") && $("c-date").value;
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) return "";
    try { var D = calData(), w = window.hasP2 && hasP2() && $("c-who") && $("c-who").value === "p2" ? D.sh2 : D.sh; return w[addD(d, -7)] || ""; } catch (e) { return ""; }
  }
  function drawPick() {
    var box = $("c-pick");
    if (!box) {
      var inp = $("c-shift"); if (!inp) return;
      box = document.createElement("div"); box.id = "c-pick";
      inp.parentNode.parentNode.insertBefore(box, inp.parentNode.nextSibling);
      box.addEventListener("click", function(e) {
        var t = e.target, v;
        if ((v = t.getAttribute("data-ps")) !== null) { P.s = +v; }
        else if ((v = t.getAttribute("data-pm")) !== null) { P.m = +v; }
        else if ((v = t.getAttribute("data-pl")) !== null) { if (P.s === null) return; $("c-shift").value = shiftStr(P.s + P.m, P.s + P.m + (+v)); }
        else if ((v = t.getAttribute("data-po")) !== null) { $("c-shift").value = v; }
        else return;
        drawPick();
      });
    }
    box.innerHTML = pickHtml();
  }
  ["c-addsh", "c-addev"].forEach(function(id) {
    var b = $(id); if (b) b.addEventListener("click", function() { P = { s: null, m: 0 }; setTimeout(function() { if (!$("c-shf").hidden) { drawPick(); if (document.activeElement === $("c-shift")) $("c-shift").blur(); } }, 0); });
  });
  var cd = $("c-date"); if (cd) cd.addEventListener("change", function() { if ($("c-pick")) drawPick(); });
  var cw = $("c-who"); if (cw) cw.addEventListener("change", function() { if ($("c-pick")) drawPick(); });
})();
