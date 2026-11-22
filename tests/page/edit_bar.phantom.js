// 10.10.5: the editing screen. Four faults seen on the fridge, each checked here:
//  1. the selected tile's overlay ("ed ed10-sel") was never removed: it stayed on the tile after DONE (a blank Calendar with
//     "CHANGE IT IN THE BAR BELOW" on the home page), and every tap on another tile left one more behind it
//  2. the bottom bar is the sleep timer, so most of it is black: the chips had black borders and black text and vanished there
//  3. the selected tile's hint sat on the same line as its name instead of under it
//  4. the PREV / NEXT buttons said CHEVL / CHEVR (the icon names are chevL / chevR, the label table was lowercase)
//  5. the masthead's middle cell was too narrow for "GOOD EVENING" / "EDITING LAYOUT": the last letter was clipped
//  6. (the owner asked) the selected tile carries its own size / order / shuffle buttons; the bar has only page, hide and add;
//     a plain white bar while editing; the home bar's page flip says PAGE 2 / PAGE 1. A tap on a button on the tile must not also
//     select / deselect the tile.
// Run via t26.sh, or: OPENSSL_CONF=/dev/null phantomjs --local-to-remote-url-access=yes --web-security=no page/edit_bar.phantom.js <copy of mesquite dir with state.js and data.js>
var sys = require('system'), dir = sys.args[1], errs = [], bad = 0;
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function() { try { localStorage.clear(); localStorage.setItem("pg_rot6", "90"); localStorage.setItem("pg_tour99", "1"); } catch (e) {} }); };
page.onError = function(m, t) { errs.push(m + " @ " + (t[0] && (t[0].file || "").split("/").pop() + ":" + t[0].line)); };
function say(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) bad++; }
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  var r = page.evaluate(function() {
    var o = {}, i;
    function count() { return document.querySelectorAll(".ed").length; }
    function lum(c) { var m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? (+m[1] + +m[2] + +m[3]) / 3 : -1; }
    // 5. the masthead, in its normal state
    var mc = document.getElementById("mast-c"), ms = document.getElementById("masthead");
    o.mastNormal = [mc.offsetWidth, mc.scrollWidth, ms.offsetWidth];
    // 4. labels
    var host = document.createElement("div"); document.body.appendChild(host);
    addIconBtn(host, "chevR", function() {}); addIconBtn(host, "chevL", function() {});
    var ls = host.getElementsByTagName("span"), lab = [];
    for (i = 0; i < ls.length; i++) if (ls[i].className === "ic-l") lab.push(ls[i].innerHTML);
    o.labels = lab.join(","); document.body.removeChild(host);
    // 1. overlays
    enterEdit();
    o.onEnter = count();
    ED_SEL = "cal"; renderEditOverlays(); SB.ctx = null; renderSysbarContext();
    o.selected = count();
    ED_SEL = "wx"; renderEditOverlays();
    o.reselected = count();
    o.tiles = ed10Visible().length;
    // 2. the chips, with the bar's timer fill under the whole bar (the worst case)
    document.getElementById("countdown-rule").style.width = "100%";
    ED_SEL = "cal"; renderEditOverlays(); SB.ctx = null; renderSysbarContext();
    var ch = document.querySelectorAll("#sysbar .tray-chip"), hid = [];
    for (i = 0; i < ch.length; i++) {
      var cs = getComputedStyle(ch[i]), warn = / warn/.test(" " + ch[i].className);
      var face = lum(cs.backgroundColor), ink = lum(cs.color), edge = lum(cs.borderTopColor);
      if (warn ? !(face < 50 && ink > 200 && edge > 200) : !(face > 200 && ink < 50)) hid.push(ch[i].innerHTML + " face=" + cs.backgroundColor + " ink=" + cs.color + " edge=" + cs.borderTopColor);
    }
    o.chips = ch.length; o.hiddenChips = hid.join(" ; ");
    // 3. the hint is on its own line, below the name
    var nm = document.querySelector(".ed10-sel .ed-name"), ht = document.querySelector(".ed10-sel .ed10-hint");
    o.hintBelow = !!(nm && ht && ht.offsetTop >= nm.offsetTop + nm.offsetHeight - 2);
    // 5. the masthead while editing
    o.mastEdit = [mc.offsetWidth, mc.scrollWidth];
    var ed = mc.getElementsByTagName("span")[0]; o.edLabel = ed ? ed.offsetWidth : 0;
    // 6. the plain bar, what is on the tile, what is in the bar, and that every size of every tile fits its controls
    o.plain = getComputedStyle(document.getElementById("countdown-rule")).display;
    var bs = document.querySelectorAll(".ed10-sel .ed-b"), on = []; for (i = 0; i < bs.length; i++) { var a = bs[i].getAttribute("data-a"); on.push(a === "sz" ? bs[i].getAttribute("data-v") : a); }
    o.onTile = on.join(",");
    var bc = document.querySelectorAll("#sysbar .tray-chip"), bn = []; for (i = 0; i < bc.length; i++) bn.push(bc[i].innerHTML.replace(/&amp;/g, "&")); o.barChips = bn.join("|").replace(/\u25B6/g, "\u25B6");
    var over = [], tl = ed10Visible(), SZ = ["S", "M", "L", "XL"];
    for (var q = 0; q < tl.length; q++) for (var z = 0; z < SZ.length; z++) {
      var keep = tl[q].sz; tl[q].sz = SZ[z]; relayout(); ED_SEL = tl[q].id; renderEditOverlays();
      var ovq = document.querySelector(".ed10-sel"); if (ovq && ovq.scrollHeight > ovq.clientHeight + 2) over.push(tl[q].id + "/" + SZ[z] + " by " + (ovq.scrollHeight - ovq.clientHeight));
      tl[q].sz = keep;
    }
    relayout(); o.overflowed = over.join(" ");
    ED_SEL = "";
    // back to the home page
    exitEdit();
    o.afterDone = count();
    return o;
  });
  say(r.onEnter === r.tiles || r.onEnter > 0, "entering edit puts an overlay on each tile (" + r.onEnter + ")");
  say(r.selected === r.tiles, "selecting a tile: " + r.selected + " overlays for " + r.tiles + " tiles");
  say(r.reselected === r.tiles, "selecting another tile: still " + r.reselected + " overlays for " + r.tiles + " tiles (no leftovers)");
  say(r.afterDone === 0, "after DONE no overlay is left on the home page (" + r.afterDone + ")");
  say(r.chips === 3 && !r.hiddenChips, "every bar chip is readable over a black bar (" + r.chips + " chips" + (r.hiddenChips ? ", unreadable: " + r.hiddenChips : "") + ")");
  say(r.hintBelow, "the 'change it in the bar' hint is under the tile's name");
  say(r.labels === "NEXT,PREV", "the next / previous buttons say " + r.labels);
  say(r.mastNormal[1] <= r.mastNormal[0] && r.mastNormal[0] > r.mastNormal[2] * 0.8, "the masthead's middle cell (" + r.mastNormal[0] + " of " + r.mastNormal[2] + ") holds its text (" + r.mastNormal[1] + ")");
  say(r.mastEdit[1] <= r.mastEdit[0] && r.edLabel + 10 < r.mastEdit[0], "EDITING LAYOUT (" + r.edLabel + " wide) fits its cell (" + r.mastEdit[0] + ")");
  say(r.plain === "none", "no sleep-timer fill behind the bar while editing (" + r.plain + ")");
  say(r.onTile === "S,M,L,XL,mv,mv,rot", "the selected tile carries: " + r.onTile);
  say(r.barChips === "TO PAGE 2 \u25B6|HIDE|ADD / OPTIONS", "the bar has only: " + r.barChips);
  say(r.overflowed === "", "every size of every tile fits its controls" + (r.overflowed ? " - overflowing: " + r.overflowed : ""));
  // real taps through the page's own event path
  function pt(sel) { return page.evaluate(function(sel) { var e = document.querySelector(sel); if (!e) return null; var b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; }, sel); }
  function st() { return page.evaluate(function() { var it = findItem("news"); return { sel: ED_SEL, sz: it.sz, rot: it.rot ? 1 : 0, idx: (function() { var l = LAYOUT[orientKey()]; for (var i = 0; i < l.length; i++) if (l[i].id === "news") return i; })() }; }); }
  page.evaluate(function() { var it = findItem("news"); it.sz = "M"; it.rot = 0; it.pg = 0; enterEdit(); ED_SEL = "news"; renderEditOverlays(); SB.ctx = null; renderSysbarContext(); });
  var steps = [
    function() { var p = pt(".ed10-sel .ed-b[data-v='XL']"); page.sendEvent("click", p.x, p.y); },
    function() { var o = st(); say(o.sz === "XL" && o.sel === "news", "tapping XL on the tile: size " + o.sz + ", tile still selected (" + o.sel + ")"); var p = pt(".ed10-sel .ed-b[data-a='rot']"); page.sendEvent("click", p.x, p.y); },
    function() { var o = st(); say(o.rot === 1 && o.sel === "news", "tapping SHUFFLE on the tile: shuffle " + o.rot + ", tile still selected"); var p = pt(".ed10-sel .ed-b[data-a='mv'][data-v='-1']"); window.IDX0 = o.idx; page.sendEvent("click", p.x, p.y); },
    function() { var o = st(); say(o.idx === window.IDX0 - 1 && o.sel === "news", "tapping the left arrow moves the tile up one (" + window.IDX0 + " -> " + o.idx + "), still selected"); var p = pt(".ed10-sel .ed-name"); page.sendEvent("click", p.x, p.y); },
    function() { var o = st(); say(o.sel === "", "tapping the tile itself deselects it (" + (o.sel || "none") + ")"); 
      var l = page.evaluate(function() { exitEdit(); FEEL.swipe = "both"; var it = findItem("news"); it.pg = 1; relayout(); SB.ctx = null; renderSysbarContext(); var a = [], e = document.querySelectorAll("#sysbar .ic-l"); for (var i = 0; i < e.length; i++) a.push(e[i].innerHTML); 
        PAGE = 1; SB.ctx = null; renderSysbarContext(); e = document.querySelectorAll("#sysbar .ic-l"); var b = []; for (i = 0; i < e.length; i++) b.push(e[i].innerHTML); PAGE = 0; return a.join(",") + " | " + b.join(","); });
      say(/PAGE 2/.test(l.split("|")[0]) && /PAGE 1/.test(l.split("|")[1]), "the home bar's page flip says where it goes: " + l); }
  ];
  var k = 0; (function run() { if (k >= steps.length) { say(!errs.length, "page errors: " + (errs.length ? errs.slice(0, 3).join(" ; ") : "none")); phantom.exit(bad ? 1 : 0); return; } try { steps[k++](); } catch (e) { say(false, "step " + k + " threw " + e); } setTimeout(run, 400); })();
}, 7000);
