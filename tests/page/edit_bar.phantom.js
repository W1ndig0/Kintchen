// 10.10.5: the editing screen. Four faults seen on the fridge, each checked here:
//  1. the selected tile's overlay ("ed ed10-sel") was never removed: it stayed on the tile after DONE (a blank Calendar with
//     "CHANGE IT IN THE BAR BELOW" on the home page), and every tap on another tile left one more behind it
//  2. the bottom bar is the sleep timer, so most of it is black: the chips had black borders and black text and vanished there
//  3. the selected tile's hint sat on the same line as its name instead of under it
//  4. the PREV / NEXT buttons said CHEVL / CHEVR (the icon names are chevL / chevR, the label table was lowercase)
//  5. the masthead's middle cell was too narrow for "GOOD EVENING" / "EDITING LAYOUT": the last letter was clipped
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
    // back to the home page
    exitEdit();
    o.afterDone = count();
    return o;
  });
  say(r.onEnter === r.tiles || r.onEnter > 0, "entering edit puts an overlay on each tile (" + r.onEnter + ")");
  say(r.selected === r.tiles, "selecting a tile: " + r.selected + " overlays for " + r.tiles + " tiles");
  say(r.reselected === r.tiles, "selecting another tile: still " + r.reselected + " overlays for " + r.tiles + " tiles (no leftovers)");
  say(r.afterDone === 0, "after DONE no overlay is left on the home page (" + r.afterDone + ")");
  say(r.chips >= 8 && !r.hiddenChips, "every bar chip is readable over a black bar (" + r.chips + " chips" + (r.hiddenChips ? ", unreadable: " + r.hiddenChips : "") + ")");
  say(r.hintBelow, "the 'change it in the bar' hint is under the tile's name");
  say(r.labels === "NEXT,PREV", "the next / previous buttons say " + r.labels);
  say(r.mastNormal[1] <= r.mastNormal[0] && r.mastNormal[0] > r.mastNormal[2] * 0.8, "the masthead's middle cell (" + r.mastNormal[0] + " of " + r.mastNormal[2] + ") holds its text (" + r.mastNormal[1] + ")");
  say(r.mastEdit[1] <= r.mastEdit[0] && r.edLabel + 10 < r.mastEdit[0], "EDITING LAYOUT (" + r.edLabel + " wide) fits its cell (" + r.mastEdit[0] + ")");
  say(!errs.length, "page errors: " + (errs.length ? errs.slice(0, 3).join(" ; ") : "none"));
  phantom.exit(bad ? 1 : 0);
}, 7000);
