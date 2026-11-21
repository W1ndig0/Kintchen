// 10.10.2: the standby clock from pictures on the night screen too (nt-cw), and the position sent to the loop.
// Run: OPENSSL_CONF=/dev/null phantomjs --local-to-remote-url-access=yes --web-security=no page/night_clock.phantom.js <copy of mesquite with art/ unpacked, state.js sleeping 1>
var page = require('webpage').create(), sys = require('system'), dir = sys.args[1], errs = [], reqs = [];
page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function() { try { localStorage.clear(); localStorage.setItem("pg_rot6", "90"); localStorage.setItem("pg_tour99", "1"); } catch (e) {} }); };
page.onError = function(m, t) { errs.push(m + " @ " + (t[0] && (t[0].file || "").split("/").pop() + ":" + t[0].line)); };
page.onResourceRequested = function(r) { if (/8765/.test(r.url)) { var m = decodeURIComponent(r.url).match(/(sclk|swx)=([^&]*)/); if (m) reqs.push(m[1] + "=" + m[2]); } };
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  console.log("day: " + page.evaluate(function() { renderFront(); var c = clk10El(); return (c ? c.id + " imgs=" + c.getElementsByTagName("img").length + " src=" + (c.getElementsByTagName("img")[0] || {}).src : "no clock") + " | " + ($("front").getElementsByClassName("fp-k")[0] || {}).innerHTML; }).replace(/file:\/\/[^ ]*art\//, "art/"));
  var nr = page.evaluate(function() { autoMode = function() { return "night"; }; FRONT10_H = ""; renderFront(); var c = clk10El(); return (c ? c.id + " imgs=" + c.getElementsByTagName("img").length + " src=" + (c.getElementsByTagName("img")[0] || {}).src : "no clock") + " | " + ($("front").getElementsByClassName("au-sub")[0] || {}).innerHTML; }).replace(/file:\/\/[^ ]*art\//, "art/");
  console.log((/^nt-cw imgs=6 src=art\/clk\/x\//.test(nr) ? "PASS" : "FAIL") + " night screen clock from pictures: " + nr);
  setTimeout(function() {
    var c = reqs.filter(function(q) { return /^sclk=x_/.test(q); }).length;
    console.log((c ? "PASS" : "FAIL") + " night screen: clock position sent to the loop (" + (reqs[0] || "nothing") + ")");
    console.log((errs.length ? "FAIL" : "PASS") + " page errors: " + (errs.join(" ; ") || "none"));
    phantom.exit();
  }, 1500);
}, 7000);
