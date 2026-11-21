// 10.10.1: the rail's minute redraw took the status (awake, battery, updated) with it and nothing put it back, so
// every bottom-bar refresh after the first new minute failed: frozen countdown, errors on every tap, Settings stuck.
// Here: the page awake in Settings, the rail redrawn by its own timer, then the bar refreshed. Expect: status back,
// no errors. Also: while the hub sleeps, a tap only asks the loop to wake (it doesn't open anything).
// Run: OPENSSL_CONF=/dev/null phantomjs --local-to-remote-url-access=yes --web-security=no page/rail_status.phantom.js <copy of mesquite dir with state.js and data.js>
var sys = require('system'), dir = sys.args[1], errs = [], reqs = [];
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function() { try { localStorage.clear(); localStorage.setItem("pg_rot6", "90"); localStorage.setItem("pg_tour99", "1"); } catch (e) {} }); };
page.onError = function(m, t) { errs.push(m + " @ " + (t[0] && (t[0].file || "").split("/").pop() + ":" + t[0].line)); };
page.onResourceRequested = function(r) { if (/8765/.test(r.url)) reqs.push((r.url.match(/save\?([a-z0-9]+)/) || [])[1]); };
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  var r = page.evaluate(function() {
    openHub(); selectTab("security");
    RAIL.sig = "";                                                                           // the minute changed
    for (var i = 0; i < KH_JOBS.length; i++) if (KH_JOBS[i].ms === 20000) KH_JOBS[i].fn();      // the rail's own timer
    var threw = "", after = !!document.getElementById("status-ic");
    try { refreshSysbar(false); refreshSysbar(true); } catch (e) { threw = String(e); }
    // and if something else ever drops it: the next refresh puts it back
    if (SBR.box.parentNode) SBR.box.parentNode.removeChild(SBR.box);
    try { refreshSysbar(false); } catch (e) { threw += " | " + e; }
    return { after: after, status: !!document.getElementById("status-ic"), threw: threw };
  });
  console.log((r.after && r.status && !r.threw ? "PASS" : "FAIL") + " rail redraw: status still there " + r.after + ", after a refresh " + r.status + (r.threw ? ", threw " + r.threw : ", no errors"));
  page.evaluate(function() { closeHub(); HUB.sleeping = 1; });
  reqs = [];
  page.sendEvent("click", 618, 824);
  setTimeout(function() {
    var v = page.evaluate(function() { return currentView; });
    console.log((v === "main" && reqs.indexOf("touch") >= 0 ? "PASS" : "FAIL") + " tap while asleep: view " + v + ", loop asked to wake: " + (reqs.indexOf("touch") >= 0));
    console.log((errs.length ? "FAIL" : "PASS") + " page errors: " + (errs.length ? errs.slice(0, 3).join(" ; ") : "none"));
    phantom.exit();
  }, 1500);
}, 7000);
