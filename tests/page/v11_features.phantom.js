// 11.2: fridge side of the PC features: a layout sent from the PC is applied once (and marked done), the settings are
// backed up for the PC, the PRICE CHECK button under the list asks the PC, the PC's answer shows there, and the
// Settings > PC pane has PAIR WITH YOUR PC. Run via t30.sh.
var sys = require('system'), dir = sys.args[1], errs = [], bad = 0;
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function() { try { if (!sessionStorage.getItem("kh_t30")) { localStorage.clear(); sessionStorage.setItem("kh_t30", "1"); }
    localStorage.setItem("pg_tour99", "1"); } catch (e) {} }); };
page.onError = function(m, t) { errs.push(m + " @ " + (t[0] && (t[0].file || "").split("/").pop() + ":" + t[0].line)); };
function say(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) bad++; }
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  var r = page.evaluate(function() {
    var o = {};
    o.rot = localStorage.getItem("pg_rot6");
    o.cfgpc = (itemsOf("cfg").filter(function(c) { return c.id === "cfgpc"; })[0] || {}).state;
    openShop();
    o.foot = document.getElementById("sv-foot").innerText;
    var b = document.getElementById("sv-price");
    o.hasBtn = !!b;
    if (b) { var ev = document.createEvent("MouseEvents"); ev.initMouseEvent("click", true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null); b.dispatchEvent(ev);
             if (typeof bindTap === "function") { try { b.onclick && b.onclick(); } catch (e) {} } }
    o.asked = itemsOf("pcreq").filter(function(x) { return x.text === "pricecheck" && x.state === "open"; }).length;
    closeShop && closeShop();
    openHub(); selectTab("phone");
    o.pairBtn = (document.getElementById("ph-pairbtn") || {}).innerText || "";
    cfgBackup(false);
    o.backup = !!itemsOf("cfg").filter(function(c) { return c.id === "cfgkindle"; }).length;
    return o;
  });
  say(r.rot === "90", "the layout sent from the PC was applied (rotation " + r.rot + ")");
  say(r.cfgpc === "done", "and marked done for the PC (" + r.cfgpc + ")");
  say(r.hasBtn, "PRICE CHECK button under the list");
  say(/Cheapest: Walmart \$42\.10/.test(r.foot), "the PC's answer shows under the list: " + r.foot.replace(/\s+/g, " ").slice(-120));
  say(/PAIR AGAIN|PAIR WITH YOUR PC/.test(r.pairBtn), "Settings > PC has the pairing button: " + r.pairBtn);
  say(r.backup, "settings are backed up for the PC (cfgkindle)");
  say(errs.length === 0, "page errors: " + (errs.join(" | ") || "none"));
  phantom.exit(bad ? 1 : 0);
}, 9000);
