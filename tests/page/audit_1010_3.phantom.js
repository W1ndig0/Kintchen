// 10.10.3 page fixes, both of which fail on 10.10.2:
//   1. the shopping list's QR button was bound to the function as it was BEFORE v109 wrapped it, so it
//      always showed the old static snapshot instead of the live-list link for a paired phone.
//   2. after a suspend the clock jumps, so every shared-timer job was due at once and they all ran in
//      one burst - the lag people felt right after a wake.
// Run: OPENSSL_CONF=/dev/null phantomjs --local-to-remote-url-access=yes --web-security=no page/audit_1010_3.phantom.js <copy of mesquite with state.js>
var sys = require('system'), dir = sys.args[1], errs = [];
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function() { try { localStorage.clear(); localStorage.setItem("pg_rot6", "90"); localStorage.setItem("pg_tour99", "1"); } catch (e) {} }); };
page.onError = function(m, t) { errs.push(m + " @" + (t && t[0] ? (t[0].file || "").split("/").pop() + ":" + t[0].line : "?")); };
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  var r = page.evaluate(function() {
    var o = {};
    // 1. the QR button must reach whatever openShopQR is NOW, not the copy from load time
    window.HUB_CLOUD = { pages: "https://example.github.io/hub/", gist: "abc123" };
    var marker = 0, real = openShopQR;
    openShopQR = function() { marker = 1; };
    var b = document.getElementById("sv-qr"), t = b && b.__taps;
    try { if (t && t.length) t[0].fn(); } catch (e) { o.qrThrew = String(e); }
    openShopQR = real;
    o.qrLive = marker;
    // 2. a jump in the clock must not fire every job in one tick
    var i; window.__ran = 0;
    for (i = 0; i < KH_JOBS.length; i++) KH_JOBS[i].fn = function() { window.__ran++; };
    for (i = 0; i < KH_JOBS.length; i++) KH_JOBS[i].at = new Date().getTime() - 3600000;   // an hour asleep
    KH_LAST = new Date().getTime() - 3600000;
    o.jobs = KH_JOBS.length;
    return o;
  });
  console.log((r.qrLive ? "PASS" : "FAIL") + " shopping list QR button reaches the current openShopQR" + (r.qrThrew ? " (threw " + r.qrThrew + ")" : ""));
  setTimeout(function() {
    var r2 = page.evaluate(function() { return { ran: window.__ran, jobs: KH_JOBS.length, due: 0 }; });
    // an hour asleep: at most the one 2.5 s job should have run in the two ticks since, not all of them
    console.log((r2.ran <= 2 ? "PASS" : "FAIL") + " an hour asleep does not fire every job at once: " + r2.ran + " of " + r2.jobs + " jobs ran in the next two ticks");
    console.log((errs.length ? "FAIL" : "PASS") + " page errors: " + (errs.join(" | ") || "none"));
    phantom.exit();
  }, 4000);
}, 8000);
