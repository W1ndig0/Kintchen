// 10.9.3: start the real page (PhantomJS = old WebKit like the Kindle) with saved and synced list items of every
// kind, mismatched three ways. 10.9-10.9.2 crashed here (DIAG_SENT read before it was set) and never started.
// Run: OPENSSL_CONF=/dev/null phantomjs --local-to-remote-url-access=yes --web-security=no page/startup_items.phantom.js <copy of mesquite dir> cache|file|both
var sys = require('system'), dir = sys.args[1], mode = sys.args[2];
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
var kinds = "billpd book cfg chdone cmd event msg pantry pkg plan recipe repeat req shift shop sketch".split(" "), now = 1795195779345, cache = "#hub v1\n", file = [];
kinds.forEach(function(k, i) {
  var a = (now + i) + "\tc" + i + k + "\t" + k + "\topen\t" + (k === "event" ? "2026-11-21 09:00|Dentist" : k === "shift" ? "2026-11-21|0700|1500" : "Item " + k);
  var b = (now - 9000 + i) + "\tf" + i + k + "\t" + k + "\topen\tFile " + k;
  if (mode !== "file") cache += a + "\n";
  if (mode !== "cache") file.push(b, (now - 5000 + i) + "\tc" + i + k + "\t" + k + "\tdel\tgone");
});
page.onInitialized = function() { page.evaluate(function(c) { try { localStorage.clear(); localStorage.setItem("pg_items_v95", c); } catch (e) {} }, cache); };
var fs = require('fs'); fs.write(dir + "/hub_items.js", "window.HUB_ITEMS=" + JSON.stringify({ at: 7, lines: file }) + ";", "w");
var errs = 0, boot = 0;
page.onError = function(m, t) { errs++; console.log("  JSERROR " + m + " @ " + (t[0] && t[0].line)); };
page.onResourceRequested = function(r) { if (/boot=/.test(r.url)) boot = 1; if (/pgerr=/.test(r.url)) console.log("  " + decodeURIComponent(r.url).substring(29, 160)); };
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() { console.log(mode + ": errors " + errs + ", boot sent " + boot); phantom.exit(); }, 13000);
