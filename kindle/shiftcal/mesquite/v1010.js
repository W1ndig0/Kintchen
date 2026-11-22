/* Kitchen Hub 10.10 — loaded after v109.js. Speed, battery and the frame (rail, bottom bar, editing).
 * ES5 only (the Kindle's browser). See UPDATE_10.10.txt.
 *  - data.js / hub_items.js are re-read only when the loop says a sync or edit burst finished (state "dataN")
 *  - the standby clock is drawn from pictures (art/clk), the same ones the loop draws each minute while the
 *    Kindle sleeps; the page tells the loop where each digit is (sclk=) and where the weather picture is (swx=)
 *  - the status lives in the left rail; the whole bottom bar is the sleep timer; APPS sits at the bottom of the rail
 *  - editing: tap a tile to select it, its controls are in the bottom bar
 *  - Settings > Sleep: the new sleep, sync and battery settings, and the daily energy report
 */
khNow("v1010.js: started");

// ---------------------------------------------------------------- look
(function() {
    var css = document.createElement("style");
    css.textContent =
        "#sysbar { font-size: 150%; }" +                                             // bottom-bar buttons 50% bigger
        "body.asleep #sysbar { font-size: 100%; }" +
        "#countdown-rule { top: 0 !important; height: 100% !important; z-index: 0; }" +  // the whole bar is the sleep timer
        "#sb-row { position: relative; z-index: 1; }" +
        "#sysbar .tray-lbl.inv10w { color: #fff; }" +
        // 10.10.5: the whole bar is the sleep timer, so part of it is black: a chip with a black border and black text was
        // invisible there (only the inverted one showed). Every chip has its own white face; the chosen one is black with a white edge.
        "#sysbar .tray-chip { padding: .5em .75em; margin: .1em .18em; border-width: 3px; background: #fff; color: #000; }" +
        "#sysbar .tray-chip.warn { background: #000; color: #fff; border: 3px solid #fff; }" +
        "#sysbar .txt-btn { padding: .5em .85em; }" +
        "#sb-right { width: 15%; }" +                                                  // the bigger SETTINGS button fits
        "#rail .rl-foot { padding: .55em 0 .5em; font-size: .7em; letter-spacing: .08em; }" +
        "#rail .rl-foot .rl-ic { width: 2.6em; height: 2.6em; margin-bottom: .2em; }" +
        "#rail .sb10-stale { background: #000; color: #fff; }" +
        "body.editing #countdown-rule { display: none !important; }" +                // 10.10.5: a plain white bar while editing (the countdown is in the rail)
        ".ed.ed10-sel { border: .45em solid #000; }" +
        ".ed.ed10-sel .ed-b { padding: .4em .8em; margin: .18em .14em; font-size: .9em; }" +      // 10.10.5: the controls are on the tile: finger-sized
        ".ed.ed10-sel .ed-row { margin-top: .5em; }" +
        ".ed10-hint { font: 900 .62em Helvetica, Arial, sans-serif; letter-spacing: .14em; margin-top: .7em; }" +
        ".ed.ed10-sel .ed10-hint { background: #000; color: #fff; display: table; margin: .7em auto 0; padding: .25em .6em; }" +      // 10.10.5: on its own line (the name is inline-block, so an inline-block hint sat beside it)
        "#fp-cw img { display: inline-block; vertical-align: top; }" +
        ".fp-zz { font-size: .4em; letter-spacing: .1em; }" +
        ".fp-wx10 { overflow: hidden; }" +
        ".fp-wx10 .fp-k2 { overflow: hidden; }" +                                       // 10.10.5: the caption stays beside the picture (it wrapped under it on the narrow, upright page)
        ".fp-wx10 img.fp-wxa { float: left; width: 200px; height: 200px; margin: 0 .3em .2em 0; }" +
        ".fp-bird10 img { display: block; max-width: 100%; max-height: 9em; margin: .15em 0; -webkit-filter: grayscale(1); filter: grayscale(1); }" +
        ".fp-bird10 .fp-bn { font-weight: 900; }";
    document.getElementsByTagName("head")[0].appendChild(css);
})();
// the rail is always there now (no HIDE): bring it back if an older version hid it
if (FEEL.rail === 0) { FEEL.rail = 1; try { saveFeel(); } catch (e) {} }

// ---------------------------------------------------------------- data only when it changed
var DN_SEEN = null, SLEEP_WAS10 = null;
// 10.10.3: two safety nets, after a freeze that left nothing in the log at all.
//  * If anything in the state chain throws, the page says so once and carries on. Before, one bad element
//    could throw on every poll and the screen would sit there with nothing to show for it.
//  * state.js is a script: if the loop ever writes a file that doesn't parse, the browser still reports a
//    successful load and the page quietly keeps its LAST state for ever. The loop stamps "now" into every
//    write, so a "now" that stops moving while the hub should be awake means exactly that - say so once.
var ST10_ERR = 0, ST10_NOW = 0, ST10_AT = 0, ST10_SAID = 0;
function st10Watch(s) {
    var t = new Date().getTime(), n = parseInt(s && s.now, 10) || 0;
    if (n !== ST10_NOW) { ST10_NOW = n; ST10_AT = t; ST10_SAID = 0; return; }
    if (ST10_SAID || !ST10_AT || t - ST10_AT < 150000) return;
    if (HUB.sleeping) { ST10_AT = t; return; }                       // asleep: the loop is not writing anyway
    ST10_SAID = 1;
    khSay("pgerr=" + encodeURIComponent("state.js has not changed for " + Math.round((t - ST10_AT) / 1000) + "s - it may not be valid JavaScript"));
}
var __applyState1010 = applyState;
applyState = function(s) {
    st10Watch(s);
    try { __applyState1010(s); } catch (e) {
        ST10_ERR++;
        if (ST10_ERR <= 2) khSay("pgerr=" + encodeURIComponent("state: " + e));
    }
    if (!s) return;
    if (s.dataN !== undefined) {
        var dn = parseInt(s.dataN, 10) || 0;
        if (DN_SEEN === null) DN_SEEN = dn;
        else if (dn !== DN_SEEN) { DN_SEEN = dn; reloadDataScript(); reloadItemsScript(); }     // a sync or edit burst finished
    }
    if (SLEEP_WAS10 !== null && SLEEP_WAS10 !== HUB.sleeping) relayout();      // the bottom bar is smaller while asleep
    SLEEP_WAS10 = HUB.sleeping;
    if (HUB.sleeping && parseInt(s.quick, 10) === 1) front10Hourly();      // the hourly redraw: a fresh standby page
};
// minute ticks while asleep: only the clock (data comes with the loop's counter, above)
quietRefresh = function() { if (!front10Hourly()) frontClock(); pollState(); };
// filler cards and boosts are decided once per wake, so tiles don't move around while you look
var __onWake1010 = onWake;
onWake = function() { FILLER_MEMO.v = null; __onWake1010(); };

// ---------------------------------------------------------------- the status in the rail, always
sbFit = function() {
    if (!$("sb-left")) return;
    var can = RAIL_W > 0 && !HUB.sleeping && $("rail").style.display !== "none";
    if (can && !SBR.on) sbPut(true); else if (!can && SBR.on) sbPut(false);
    else if (SBR.on && !sb10InDoc()) sbPut(true);      // 10.10.1: the rail was redrawn under it: put the status back
};
// 10.10.1: the rail's minute redraw (rl.innerHTML) took the status with it and nothing put it back (10.10 dropped the
// 20 s re-check that used to): from the first new minute on, every bar refresh failed on the missing status
// elements, so the countdown froze, taps threw errors and state updates stopped halfway (the freezing Settings).
function sb10InDoc() { var b = SBR.box; while (b && b !== document.body) b = b.parentNode; return !!b; }
ICONS.pg2 = ICONS.chevR; ICONS.pg1 = ICONS.chevL; IC_LABEL.pg2 = "PAGE 2"; IC_LABEL.pg1 = "PAGE 1";      // 10.10.5: the home bar's page flip says where it goes
var __ctxList1010 = ctxList;
ctxList = function() {          // APPS is in the rail now
    var l = __ctxList1010();
    if (currentView === "main") for (var q = 0; q < l.length; q++) { if (l[q][0] === "chevR") l[q][0] = "pg2"; else if (l[q][0] === "chevL") l[q][0] = "pg1"; }
    if (RAIL_W > 0) { var o = []; for (var i = 0; i < l.length; i++) if (l[i][0] !== "apps") o.push(l[i]); return o; }
    return l;
};

// ---------------------------------------------------------------- the bottom bar is the sleep timer
var SB10 = { sig: "", stale: "" };
function sb10Invert() {
    var bar = $("sysbar"); if (!bar) return;
    var fill = (HUB.sleeping || EDIT) ? 0 : (SB.rule || 0) * bar.clientWidth;      // 10.10.5: no fill while editing
    var els = [], k, i;
    var boxes = [$("sb-mid"), $("sb-right")];
    for (k = 0; k < boxes.length; k++) if (boxes[k]) { var c = boxes[k].childNodes; for (i = 0; i < c.length; i++) if (c[i].nodeType === 1) els.push(c[i]); }
    var sig = Math.round(fill) + "|" + els.length;
    if (sig === SB10.sig) return;
    SB10.sig = sig;
    for (i = 0; i < els.length; i++) {
        var e = els[i], x = 0, n = e;
        while (n && n !== bar) { x += n.offsetLeft || 0; n = n.offsetParent; if (n === $("sb-row")) { x += 0; } }
        var over = x + e.offsetWidth / 2 < fill;
        if (/tray-lbl/.test(e.className) && hasCls(e, "inv10w") !== over) setCls(e, "inv10w", over);      // plain text: white on the black part
    }
}
var __refreshSysbar1010 = refreshSysbar, SB10_SLP = null;
refreshSysbar = function(force) {
    if (SBR.on && !sb10InDoc()) sbPut(true);
    // every state update forced a full rebuild of the bottom bar: buttons were destroyed and redrawn about a second
    // after each tap (the loop answers a tap with a new state), so the next tap on them often went nowhere
    if (force && SB10_SLP === HUB.sleeping) force = false;
    SB10_SLP = HUB.sleeping;
    try { __refreshSysbar1010(force); } catch (e) { SB10.err = (SB10.err || 0) + 1; if (SB10.err <= 2) khSay("pgerr=" + encodeURIComponent("bar refresh: " + e)); }
    sb10Invert();
    // "Updated" turns black after 12 hours: SYNC is the only thing that fetches new data now
    var st = $("sync-t");
    if (st) {
        var age = HUB.lastSyncEpoch ? nowSec() + HUB.skew - HUB.lastSyncEpoch : 0, stale = age > 12 * 3600 ? 1 : 0;
        var sg = stale + "|" + (HUB.upd || "");
        if (sg !== SB10.stale) {
            SB10.stale = sg;
            if (stale) st.innerHTML = esc(HUB.upd || "--") + " &middot; TAP SYNC";
            setCls(st.parentNode, "sb10-stale", !!stale);
        }
    }
};
var __renderCtx1010 = renderSysbarContext;
renderSysbarContext = function() { var c0 = SB.ctx; __renderCtx1010(); if (SB.ctx !== c0) { SB10.sig = ""; sb10Invert(); } };
(function() {      // tapping the "Updated" line syncs (it's in the rail)
    var st = $("sync-t");
    if (st && st.parentNode) bindTap(st.parentNode, function() { if (!HUB.sleeping) hubSync(); });
})();

// ---------------------------------------------------------------- the standby clock, drawn from pictures
var CLK10 = { x: [191, 117, 199, 249], l: [115, 71, 120, 151], m: [82, 50, 85, 105], s: [54, 33, 56, 70] };       // digit, colon, am/pm width; height (art/clk/*/metrics.txt). x: 10.10.2, the night screen
var CLK10_SENT = "", WX10_SENT = "", CLK10_BAD = 0;
function clk10Mode() {
    var s = window.HUB_STATE || {}, m = s.sleepClock || "min";
    if (s.where === "night" && s.nightClock && s.nightClock !== "same") m = s.nightClock;
    return m;
}
function clk10Glyphs(mode) {
    var n = getBCNow(), h = n.getUTCHours() % 12 || 12, mm = n.getUTCMinutes(), ap = n.getUTCHours() >= 12 ? "pm" : "am";
    var h1 = h >= 10 ? "1" : "b", h2 = String(h % 10);
    if (mode === "hour") return [h1, h2, ap];
    return [h1, h2, "c", String(Math.floor(mm / 10)), String(mm % 10), ap];
}
function clk10Size(avail, hmax, glyphs) {
    var keys = ["x", "l", "m", "s"];
    for (var i = 0; i < keys.length; i++) {
        var M = CLK10[keys[i]], w = 0;
        for (var j = 0; j < glyphs.length; j++) w += glyphs[j] === "c" ? M[1] : (glyphs[j] === "am" || glyphs[j] === "pm" ? M[2] : M[0]);
        if (w <= avail && M[3] <= hmax) return keys[i];
    }
    return "s";
}
function clk10Send(q, which) {       // the loop needs to know where the digits / weather picture are (screen pixels)
    if (which === "c") { if (q === CLK10_SENT) return; CLK10_SENT = q; sendPower("sclk=" + q, function(r) { if (r !== "ok" && CLK10_SENT === q) CLK10_SENT = ""; }); }
    else { if (q === WX10_SENT) return; WX10_SENT = q; sendPower("swx=" + q, function(r) { if (r !== "ok" && WX10_SENT === q) WX10_SENT = ""; }); }
}
// 10.10.2: the night screen has its own clock (nt-cw). 10.10 only knew the day page's (fp-cw), so at night the page
// left its "10:—" placeholder up and the loop drew the minutes where the day page's digits had been.
function clk10El() { return $("fp-cw") || $("nt-cw"); }
frontClock = function() {
    if (!$("front") || $("front").style.display !== "block") return;
    var cw = clk10El();
    if (!cw) { clk10Send("none", "c"); return; }      // no clock on this page: the loop must not draw one
    var night = cw.id === "nt-cw";
    var S = window.HUB_STATE || {}, mode = clk10Mode();
    // while the Kindle sleeps the loop draws the minutes straight onto the screen: the page leaves them alone
    if (HUB.sleeping && S.clockBy === "loop" && cw.__drawn && mode !== "off") return;
    var g = mode === "off" ? [] : clk10Glyphs(mode), key = mode + g.join("") + HUB.next;
    if (cw.__k === key) return;
    cw.__k = key;
    var k = $("front").getElementsByClassName(night ? "au-sub" : "fp-k")[0];
    if (k) k.innerHTML = mode === "off" ? "Asleep" : (mode === "hour" ? "Asleep &middot; the hour" : "Asleep &middot; clock keeps time");
    if (mode === "off") { cw.innerHTML = "<span class='fp-zz'>SLEEPING</span>"; cw.__drawn = 0; clk10Send("none", "c"); return; }
    if (CLK10_BAD) {      // the pictures aren't on this Kindle yet: plain text, the page redraws the minute
        var n = getBCNow(), h12 = n.getUTCHours() % 12 || 12, mm = n.getUTCMinutes();
        cw.innerHTML = h12 + (mode === "hour" ? "" : "<span class='fp-dash'>:" + (mm < 10 ? "0" : "") + mm + "</span>") + "<span class='fp-ap'>" + (n.getUTCHours() >= 12 ? "PM" : "AM") + "</span>";
        cw.__drawn = 0; clk10Send("none", "c"); return;
    }
    var side = $("fp-side"), rv = tagReserve();
    var sz = night ? clk10Size((W - rv.r) * 0.85, H * 0.4, g) : clk10Size((side ? side.clientWidth : 300) - FS, side ? side.clientHeight * 0.26 : 200, g);
    var M = CLK10[sz], h = "";
    for (var i = 0; i < g.length; i++) {
        var w = g[i] === "c" ? M[1] : (g[i] === "am" || g[i] === "pm" ? M[2] : M[0]);
        h += "<img src='art/clk/" + sz + "/0/" + g[i] + ".png' width='" + w + "' height='" + M[3] + "' alt='' onerror='clk10Bad()'>";
    }
    cw.innerHTML = h; cw.__drawn = 1;
    cw.parentNode.style.fontSize = M[3] + "px"; cw.parentNode.style.lineHeight = "1";
    if (g.length !== 6) { clk10Send("none", "c"); return; }      // hour mode: no ticks to draw
    cw.__sz = sz;
    if (!FRONT10_BUSY) clk10Positions();      // while the page is being drawn the places are told at the very end (10.10.5)
};
// where the loop must draw the minutes: the digits' own places in the FINISHED layout. 10.10.5: this used to be read in the middle of
// drawing the standby page, before the weather picture and the bird went in and before the column was fitted a last time, so a
// crowded page put the digits (and the weather animation) a few pixels off their picture and over the text beside it.
function clk10Positions() {
    var cw = clk10El(); if (!cw || !cw.__drawn || !cw.__sz) return;
    var ims = cw.getElementsByTagName("img"); if (ims.length !== 6) return;
    var q = cw.__sz + "_" + getRot();
    for (var j = 0; j < ims.length; j++) { var r = ims[j].getBoundingClientRect(); q += "_" + Math.round(r.left) + "_" + Math.round(r.top); }
    clk10Send(q, "c");
}
function wx10Position() {
    var im = document.querySelector("#front .fp-wxa"); if (!im || !im.__kind) return;
    var r = im.getBoundingClientRect();
    clk10Send(im.__kind + "_" + getRot() + "_" + Math.round(r.left) + "_" + Math.round(r.top), "w");
}
var FRONT10_BUSY = 0;
function clk10Bad() { if (CLK10_BAD) return; CLK10_BAD = 1; var cw = clk10El(); if (cw) { cw.__k = ""; frontClock(); } }
// the weather picture on the standby page (the loop animates it on the hourly redraw)
function wx10Kind(code, night) {
    code = +code;
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code <= 1) return night ? "night" : "sun";
    return "cloud";
}
var __renderFront1010 = renderFront, FRONT10_H = "";
// 10.10.5: the bird's picture has no size until it has loaded, so the side column was fitted without it and then ran
// over its bottom (the horoscope cut off) when it arrived. Fit again as soon as it is there (or has failed).
function fp10Refit() { var s = $("fp-side"); if (s && $("front") && $("front").style.display === "block") { fitText(s, 9, FS * 1.3); clk10Positions(); wx10Position(); } }
function front10Hour() { var n = getBCNow(); return n.getUTCDate() + "-" + n.getUTCHours(); }
// 10.10.2: on the hourly redraw (and a minute tick that crosses the hour) the standby page is drawn again, so the
// story, the bird, the "wakes ..." line and the night screen switch actually change. 10.10 only redrew the clock.
function front10Hourly() { if (HUB.sleeping && FRONT10_H !== front10Hour()) { renderFront(); return 1; } return 0; }
renderFront = function() {
    FRONT10_H = front10Hour();
    FRONT10_BUSY = 1;
    try { front10Draw(); } finally { FRONT10_BUSY = 0; }
    clk10Positions(); wx10Position();      // 10.10.5: only now, with the layout finished
};
function front10Draw() {
    __renderFront1010();
    // 10.10.5: on the upright page the title is wider than its cell (a third of the width) and the cell cuts it: "THE KITCHEN H".
    // Shrink the title until it fits; the cell's own width stays what the page made it.
    var ttl = document.querySelector("#front .fp-mast .fp-c");
    if (ttl && ttl.scrollWidth > ttl.clientWidth + 1) {
        var tfs = parseFloat(window.getComputedStyle(ttl, null).fontSize) || 0;
        if (tfs > 0) ttl.style.fontSize = Math.max(10, Math.floor(tfs * ttl.clientWidth / ttl.scrollWidth) - 1) + "px";
    }
    var cw0 = clk10El(); if (cw0) { cw0.__k = ""; frontClock(); }      // the night screen too
    var el = $("front"); if (!el || el.style.display !== "block") return;
    var side = $("fp-side"), ic = el.getElementsByClassName("fp-wxic")[0];
    if (ic && WX && WX.current && !CLK10_BAD) {
        var ni = wxNowIndex(), night = ni >= 0 ? isNightAt(WX.hourly.time[ni]) : false, kind = wx10Kind(WX.current.weather_code, night);
        var sec = ic.parentNode; addCls(sec, "fp-wx10");
        ic.innerHTML = "<img class='fp-wxa' src='art/wx/" + kind + "/0/s.png' width='200' height='200' alt=''>";
        ic.style.display = "block";
        ic.getElementsByTagName("img")[0].__kind = kind;      // its place is told to the loop once the layout is finished (renderFront below)
    } else clk10Send("none", "w");
    // the bird of the hour, under the weather
    var b = typeof birdNow === "function" ? birdNow() : null;
    if (b && side && !side.getElementsByClassName("fp-bird10")[0]) {
        var d = document.createElement("div"); d.className = "fp-sec fp-bird10";
        d.innerHTML = "<div class='fp-h'>Bird of the hour</div><img src='" + esc(b.img) + "' alt='' onload='fp10Refit()' onerror=\"this.style.display='none';fp10Refit()\"><span class='fp-bn'>" + esc(b.n) + "</span>";
        var secs = side.getElementsByClassName("fp-sec");
        if (secs.length > 1) side.insertBefore(d, secs[1]); else side.appendChild(d);
    }
    if (side) fitText(side, 9, FS * 1.3);
};
// the hourly redraw shows a different story each hour
var __rankArticles1010 = rankArticles;
rankArticles = function() {
    var r = __rankArticles1010.apply(this, arguments);
    if (HUB.sleeping && ARTICLES && ARTICLES.length > 1) {
        var k = getBCNow().getUTCHours() % Math.min(6, ARTICLES.length);
        if (k) ARTICLES = ARTICLES.slice(k).concat(ARTICLES.slice(0, k));
    }
    return r;
};

// ---------------------------------------------------------------- 10.10.1: a tap while the hub sleeps only wakes it
// Before, the tap also did what it landed on (open Settings, an app...) while the loop went on sleeping, so the
// Kindle froze with that screen up. Now the tap is kept from the page, the loop is told at once (not at most every
// 10 s), and the page looks for the "awake" state right away. The power button works as before.
(function() {
    var last = 0, tries = [];
    function swallow(e) {
        if (!HUB.sleeping) { tries = []; return; }
        // safety: if the loop isn't answering at all (six tries within a minute and still "asleep"), taps work again
        if (tries.length >= 6 && new Date().getTime() - tries[tries.length - 6] < 60000) return;
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
        if (e.type !== "touchstart" && e.type !== "mousedown") return;
        var t = new Date().getTime();
        lastTouchAt = t;
        if (t - last < 2000) return;
        last = t; lastTouchSend = t; tries.push(t); if (tries.length > 6) tries.shift();
        sendPower("touch=1", null);
        setTimeout(pollState, 700); setTimeout(pollState, 1600); setTimeout(pollState, 3000);
    }
    var ev = ["touchstart", "touchmove", "touchend", "mousedown", "mouseup", "click"];
    for (var i = 0; i < ev.length; i++) window.addEventListener(ev[i], swallow, true);      // window: before the page's own listeners
})();

// ---------------------------------------------------------------- a kitchen timer tells the loop (it may tick it while asleep)
var T10_SENT = -1;
khEvery(5000, function() {
    var e = TIMER.end && !TIMER.done ? Math.round(TIMER.end / 1000) : 0;
    if (e !== T10_SENT && HUB.seen) { T10_SENT = e; sendPower("timerend=" + e); }
});

// ---------------------------------------------------------------- editing: tap a tile, its controls are in the bottom bar
var ED_SEL = "";
function ed10Visible() {
    var list = LAYOUT[orientKey()], vis = [];
    for (var i = 0; i < list.length; i++) { var pp = PLACED[list[i].id]; if (onPage(list[i]) && pp && !pp.nofit && !pp.hidden) vis.push(list[i]); }
    return vis;
}
var ED10_BTN = 0;      // when a button on a tile was just tapped: the tile's own "select / deselect" must not also fire
renderEditOverlays = function() {
    removeEditOverlays();
    if (!EDIT) { ED_SEL = ""; return; }
    var vis = ed10Visible(), i, seen = false;
    for (i = 0; i < vis.length; i++) if (vis[i].id === ED_SEL) seen = true;
    if (!seen) ED_SEL = "";
    for (i = 0; i < vis.length; i++) {
        var it = vis[i], p = PLACED[it.id], el = $("t-" + it.id), sel = it.id === ED_SEL;
        var ov = document.createElement("div");
        ov.className = "ed" + (sel ? " ed10-sel" : "");
        ov.style.fontSize = (sel ? clamp(Math.min(el.clientWidth / 16, el.clientHeight / 9), 10, FS * 1.2) : clamp(Math.min(el.clientWidth / 12, el.clientHeight / 6), 11, FS * 1.4)) + "px";
        var tag = p.got + (p.got !== it.sz ? " (WANTED " + it.sz + ")" : "") + (it.rot ? " &middot; SHUFFLES" : "");
        var h = "<span class='ed-num'>" + (i + 1) + "</span><span class='ed-tag'>" + tag + "</span><div class='ed-name'>" + TILE_NAMES[it.id] + "</div>";
        if (sel) {
            // 10.10.5: its size, its place in the order and the shuffle switch are on the tile; page and hide are in the bar
            h += "<div class='ed-row'>";
            for (var s2 = 0; s2 < SIZE_KEYS.length; s2++) h += "<span class='ed-b" + (SIZE_KEYS[s2] === it.sz ? " sel" : "") + "' data-a='sz' data-v='" + SIZE_KEYS[s2] + "'>" + SIZE_KEYS[s2] + "</span>";
            h += "</div><div class='ed-row'><span class='ed-b' data-a='mv' data-v='-1'>&#9664;</span><span class='ed-b' data-a='mv' data-v='1'>&#9654;</span>" +
                 "<span class='ed-b" + (it.rot ? " sel" : "") + "' data-a='rot' data-v=''>SHUFFLE</span></div>" +
                 "<div class='ed10-hint'>PAGE AND HIDE: BAR BELOW</div>";
        } else h += "<div class='ed10-hint'>TAP TO CHANGE</div>";
        ov.innerHTML = h;
        el.appendChild(ov);
        if (sel) {
            var btns = ov.getElementsByTagName("span");
            for (var b = 0; b < btns.length; b++) {
                var a = btns[b].getAttribute("data-a");
                if (!a) continue;
                (function(id, act, raw) {
                    bindTap(btns[b], function() { ED10_BTN = new Date().getTime(); edAction(id, act, act === "mv" ? parseInt(raw, 10) : raw); });
                })(it.id, a, btns[b].getAttribute("data-v"));
            }
            // a small tile has no room for the note: the controls matter more; then the type shrinks until they all fit
            if (ov.scrollHeight > ov.clientHeight + 2 && ov.lastChild && hasCls(ov.lastChild, "ed10-hint")) ov.removeChild(ov.lastChild);
            var fs2 = parseFloat(ov.style.fontSize);
            for (var tries = 0; tries < 6 && ov.scrollHeight > ov.clientHeight + 2 && fs2 > 8; tries++) { fs2 = fs2 * 0.88; ov.style.fontSize = fs2 + "px"; }
        }
        (function(id) { bindTap(ov, function() {
            if (new Date().getTime() - ED10_BTN < 250) return;      // that tap was on one of the tile's buttons
            ED_SEL = ED_SEL === id ? "" : id; renderEditOverlays(); SB.ctx = null; renderSysbarContext();
        }); })(it.id);
    }
};
var __traySig1010 = traySig;
traySig = function() {
    var it = ED_SEL ? findItem(ED_SEL) : null;
    return __traySig1010() + "|" + ED_SEL + (it ? "|" + it.pg + (it.hid ? 1 : 0) : "");      // size and shuffle are on the tile now, not in the bar
};
var __renderTray1010 = renderTray;
renderTray = function(mid) {
    var it = ED_SEL ? findItem(ED_SEL) : null;
    if (!it || it.hid) { ED_SEL = ""; return __renderTray1010(mid); }      // nothing selected: add tiles / options
    mid.style.whiteSpace = "normal";
    var lbl = document.createElement("span"); lbl.className = "tray-lbl"; lbl.innerHTML = TILE_NAMES[it.id].toUpperCase() + ":"; mid.appendChild(lbl);
    var acts = [[PAGE === 1 ? "&#9664; TO PAGE 1" : "TO PAGE 2 &#9654;", "pg", ""], ["HIDE", "hide", ""]];
    for (var a = 0; a < acts.length; a++) (function(x) {
        var c = document.createElement("span"); c.className = "tray-chip"; c.innerHTML = x[0];
        bindTap(c, function() { if (x[1] === "hide") ED_SEL = ""; edAction(it.id, x[1], x[2]); SB.ctx = null; renderSysbarContext(); });
        mid.appendChild(c);
    })(acts[a]);
    var done = document.createElement("span"); done.className = "tray-chip"; done.innerHTML = "ADD / OPTIONS";
    bindTap(done, function() { ED_SEL = ""; renderEditOverlays(); SB.ctx = null; renderSysbarContext(); });
    mid.appendChild(done);
};

// ---------------------------------------------------------------- Settings > Sleep: the 10.10 settings
var EN10_TRIED = 0;
function s10Row(id, label, hint) { return "<div class='hv-row'><div class='hv-lbl'>" + label + "</div><div id='" + id + "'></div>" + (hint ? "<div class='hv-hint'>" + hint + "</div>" : "") + "</div>"; }
var __buildSmart1010 = buildSmartOpts;
buildSmartOpts = function() {
    __buildSmart1010();
    var S = window.HUB_STATE || {}, box = $("v9-power");
    if (!box) return;
    // the old wake-schedule rows are replaced by the sleep clock and the sync choice
    var sm = $("opt-smart"), sec = sm && sm.parentNode ? sm.parentNode.parentNode : null;
    if (sec) {
        sec.style.display = "none";
        if (box.parentNode !== sec.parentNode || box.previousSibling !== sec) sec.parentNode.insertBefore(box, sec.nextSibling);      // out of the hidden section
    }
    var oi = $("opt-int"); if (oi && oi.parentNode) oi.parentNode.style.display = "none";
    var nf = S.nightFrom !== undefined ? S.nightFrom : 23, nt = S.nightTo !== undefined ? S.nightTo : 6;
    var en = window.HUB_ENERGY && window.HUB_ENERGY.line ? "<div class='hv-hint'><b>Yesterday:</b> " + esc(window.HUB_ENERGY.line.replace(/^energy [0-9-]+: /, "")) + "</div>" : "";
    box.innerHTML =
        s10Row("opt-sclk", "Clock while asleep", "Every minute: the Kindle wakes for a moment and only the clock digits change (no Wi-Fi). Less often uses less battery.") +
        s10Row("opt-nclk", "At night (" + nf + ":00 &ndash; " + nt + ":00)", "") +
        s10Row("opt-hourly", "Redraw the standby page every hour", "News changes, countdowns and the day stay current; the full redraw also clears e-ink ghosting.") +
        s10Row("opt-wxanim", "Weather animation and bird of the hour", "About 10 seconds of the current weather on the hourly redraw.") +
        s10Row("opt-ndg", "Full redraw every hour at night", "Clears the faint ghosting the minute clock leaves. Off: one flash fewer each night hour.") +
        s10Row("opt-ttick", "Kitchen timer counts down while asleep", "") +
        s10Row("opt-syncm", "Get new weather, news and lists", "Tap SYNC on the Kindle any time (from the phone or PC it arrives with the daily session). The cloud makes new weather and news every 2 hours.") +
        s10Row("opt-editp", "Send what you change on the Kindle", "Right away: a short Wi-Fi burst after you add or tick something, so your phone has it too.") +
        s10Row("opt-lwake", "Fetch phone changes on every button press", "Off: they arrive with SYNC and the daily session (Wi-Fi only then).") +
        s10Row("opt-daily", "Daily session at " + (S.dailyHour !== undefined ? S.dailyHour : 3) + " am", "One short Wi-Fi visit a day: clock check, commands from your phone or PC, new data if the cloud has any, update check, battery report.") +
        s10Row("opt-lowb", "Battery saver below 15%", "The clock changes every 15 minutes and there's no animation.") +
        s10Row("opt-cdraw", "Who draws the sleeping clock", "Automatic: the background loop draws the digits (cheapest). The page: if the digits ever look wrong.") +
        s10Row("opt-light", "Light while you use it", "Kindle's own: the hub doesn't touch the light. A level: that light while the hub is awake, off while it sleeps.") +
        "<div class='hv-hint' id='v9-use'>" + (PWR.rate7 > 0 ? "Lately about <b>" + PWR.rate7 + "%</b> of the battery an hour." : "The battery use per hour shows here after a few hours on battery.") + "</div>" + en;
    function row(id, vals, labels, cur, key) { chipRow(id, vals, labels, cur, function(v) { sendPower(key + "=" + v); if (window.HUB_STATE) setTimeout(pollState, 1500); }); }
    row("opt-sclk", ["min", "15", "hour", "off"], ["Every minute", "Every 15 min", "Hour only", "Off"], S.sleepClock || "min", "sleepclock");
    row("opt-nclk", ["same", "hour", "off"], ["Same as the day", "Hour only", "Off"], S.nightClock || "same", "nightclock");
    row("opt-hourly", [1, 0], ["On", "Off"], S.hourly === 0 ? 0 : 1, "hourly");
    row("opt-wxanim", [1, 0], ["On", "Off"], S.wxAnim === 0 ? 0 : 1, "wxanim");
    row("opt-ndg", [1, 0], ["On", "Off"], S.nightDeghost === 0 ? 0 : 1, "nightdeghost");
    row("opt-ttick", [0, 1], ["Off", "On"], S.timerTick ? 1 : 0, "timertick");
    row("opt-syncm", ["manual", "2", "6", "12"], ["Only when I tap SYNC", "Every 2 h", "Every 6 h", "Every 12 h"], S.syncMode || "manual", "syncmode");
    row("opt-editp", ["now", "sync"], ["Right away", "With the next sync"], S.editPush || "now", "editpush");
    row("opt-lwake", [0, 1], ["Off", "On"], S.listsOnWake ? 1 : 0, "cloudwake");
    row("opt-daily", [1, 0], ["On", "Off"], S.daily === 0 ? 0 : 1, "daily");
    row("opt-lowb", [1, 0], ["On", "Off"], S.lowSaver === 0 ? 0 : 1, "lowsaver");
    row("opt-cdraw", ["auto", "page"], ["Automatic", "The page"], S.clockDraw || "auto", "clockdraw");
    chipRow("opt-light", [-1, 0, 4, 8, 12, 16, 20, 24], ["Kindle's own", "Off", "4", "8", "12", "16", "20", "24"], PWR.light, function(v) { PWR.light = v; sendPower("light=" + (v < 0 ? "keep" : v)); });
    // 10.10.3: the report is loaded once and the pane built again, so it shows the first time you open this
    if (!window.HUB_ENERGY && !EN10_TRIED) { EN10_TRIED = 1; loadScript("energy.js", function() { if (window.HUB_ENERGY) buildSmartOpts(); }); }
    if (typeof HVS !== "undefined") HVS.sig = "";
};
// the Status table: the real schedule instead of the old "Wakes every"
var __renderStatus1010 = renderStatusTable;
renderStatusTable = function() {
    __renderStatus1010();
    var S = window.HUB_STATE || {}, tb = $("hv-status"); if (!tb) return;
    var lab = { min: "every minute", "15": "every 15 min", hour: "hourly", off: "off" };
    var txt = "Clock " + (lab[S.sleepClock] || "every minute") + (S.hourly === 0 ? "" : " · page redrawn hourly") + (S.daily === 0 ? "" : " · daily session " + (S.dailyHour !== undefined ? S.dailyHour : 3) + " am") +
              (S.syncMode && S.syncMode !== "manual" ? " · sync every " + S.syncMode + " h" : " · sync when you tap");
    var tds = tb.getElementsByTagName("td");
    for (var i = 0; i + 1 < tds.length; i += 2) if (tds[i].innerHTML === "Wakes every") { tds[i].innerHTML = "While asleep"; tds[i + 1].innerHTML = esc(txt); }
};

khNow("v1010.js: finished");
