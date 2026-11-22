// 11.1: the fridge page says nothing about GitHub: Settings > PC, Updates and Security, and the Books screen, paired
// with the PC (cloud.js has pc:) and not paired. Run via t29.sh.
var sys = require('system'), dir = sys.args[1], mode = sys.args[2], errs = [], bad = 0;
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function() { try { localStorage.clear(); localStorage.setItem("pg_tour99", "1"); } catch (e) {} }); };
page.onError = function(m, t) { errs.push(m + " @ " + (t[0] && (t[0].file || "").split("/").pop() + ":" + t[0].line)); };
function say(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + "[" + mode + "] " + msg); if (!ok) bad++; }
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  var r = page.evaluate(function() {
    var o = {}, bad = /github|gist|cloud brain|ntfy|passphrase|pages_url|token/i;
    function txt(id) { var e = document.getElementById(id); return e ? (e.innerText || e.textContent || "") : ""; }
    openHub();
    selectTab("phone"); o.phone = txt("pane-phone"); o.tab = "";
    var ts = document.getElementById("hv-tabs").getElementsByTagName("div");
    for (var i = 0; i < ts.length; i++) o.tab += ts[i].innerHTML + "|";
    selectTab("updates"); o.updates = txt("pane-updates");
    selectTab("security"); o.security = txt("pane-security");
    closeHub();
    openXV("books", 0); o.books = txt("xv") || document.body.innerText;
    o.badPhone = bad.test(o.phone); o.badUpd = bad.test(o.updates); o.badSec = bad.test(o.security);
    o.badBooks = /gutenberg|book cloud|in your cloud|FREE BOOKS/i.test(o.books);
    return o;
  });
  say(r.tab.indexOf("PC|") >= 0, "the Phone tab is called PC (" + r.tab + ")");
  say(!r.badPhone, "Settings > PC has no GitHub/gist/ntfy words: " + r.phone.replace(/\s+/g, " ").slice(0, 160));
  say(!r.badUpd, "Settings > Updates has none: " + r.updates.replace(/\s+/g, " ").slice(0, 160));
  say(!r.badSec, "Settings > Security has none: " + r.security.replace(/\s+/g, " ").slice(0, 160));
  say(!r.badBooks, "Books: the PC's folder, no cloud or Gutenberg");
  if (mode === "paired") {
    say(/Paired with your PC at 192\.168\.1\.20:8770/.test(r.phone), "Settings > PC names the PC");
    say(/Updates come from your PC/.test(r.updates) && /CHECK FOR UPDATE/.test(r.updates), "updates come from the PC");
  } else say(/Not paired with your PC/.test(r.phone), "not paired: says how to pair");
  say(errs.length === 0, "page errors: " + (errs.join(" | ") || "none"));
  phantom.exit(bad ? 1 : 0);
}, 6000);
