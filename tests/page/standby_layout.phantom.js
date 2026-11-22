// 10.10.5: the standby (asleep) page, at every rotation, with a plain day and a crowded one (bird of the hour + four events):
//  1. the title ("THE KITCHEN HUB") must fit its cell: on the upright page a third of the width cut it to "THE KITCHEN H"
//  2. the weather caption stays beside the weather picture (it wrapped under it, and its box ran under the picture)
//  3. nothing on the page overlaps anything else (every text / picture box against every other), the side column does not overflow
//  4. the places the page tells the loop to draw the clock digits and the weather animation at are exactly where the digits
//     and the picture are in the finished layout (the loop paints straight onto the screen there)
// Run via t28.sh, or: OPENSSL_CONF=/dev/null phantomjs --local-to-remote-url-access=yes --web-security=no page/standby_layout.phantom.js <mesquite copy with state.js, data.js and art/> <rot> <plain|crowded>
var sys = require('system'), dir = sys.args[1], rot = sys.args[2], variant = sys.args[3], errs = [], bad = 0;
var page = require('webpage').create(); page.viewportSize = { width: 1236, height: 1648 };
page.onInitialized = function() { page.evaluate(function(r) { try { localStorage.clear(); localStorage.setItem("pg_rot6", r); localStorage.setItem("pg_tour99", "1"); } catch (e) {} }, rot); };
page.onError = function(m, t) { errs.push(m + " @ " + (t[0] && (t[0].file || "").split("/").pop() + ":" + t[0].line)); };
page.onResourceError = function() {};
function say(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + "[rot " + rot + " " + variant + "] " + msg); if (!ok) bad++; }
page.open("file://" + dir + "/index.html", function() {});
setTimeout(function() {
  page.evaluate(function(variant) {
    window.SENT = { c: "", w: "" }; var _s = clk10Send;
    clk10Send = function(q, w) { window.SENT[w] = q; _s(q, w); };
    if (variant === "crowded") {
      EX = EX || {}; EX.birds = [{ n: "Black-capped Chickadee (Poecile atricapillus)", img: "art/clk/m/0/0.png" }];
      EVENTS[todayKey()] = [{ title: "Dentist appointment with Dr Nakamura downtown", time: "09:30" }, { title: "Pick up the kids from swimming lessons", time: "15:45" }, { title: "Dinner at Maria and Joe's place", time: "18:00" }, { title: "Garbage day - put the bins out tonight", time: "" }];
    }
    renderFront();
  }, variant);
  setTimeout(function() {      // the pictures need a moment to load
    var o = page.evaluate(function() {
      function R(e) { var b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }
      var r = { sent: window.SENT, rot: getRot() };
      var t = document.querySelector("#front .fp-mast .fp-c"); r.title = t ? [t.clientWidth, t.scrollWidth] : null;
      var side = $("fp-side"); r.side = side ? [side.clientHeight, side.scrollHeight] : null;
      var wx = document.querySelector("#front .fp-wxa"), k2 = document.querySelector("#front .fp-k2"); r.wx = wx ? R(wx) : null; r.k2 = k2 ? R(k2) : null;
      var cw = clk10El(), im = cw ? cw.getElementsByTagName("img") : [], c = []; for (var i = 0; i < im.length; i++) c.push(R(im[i])); r.digits = c;
      var all = $("front").getElementsByTagName("*"), boxes = [];
      for (i = 0; i < all.length; i++) { var e = all[i]; if (e.tagName === "IMG" || (e.children.length === 0 && (e.textContent || "").replace(/\s/g, "") !== "")) { var b = R(e); if (b[2] > b[0] && b[3] > b[1]) boxes.push({ n: (e.className || e.tagName), b: b }); } }
      function hit(a, b) { return a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2; }
      r.over = []; for (i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) if (hit(boxes[i].b, boxes[j].b)) r.over.push(boxes[i].n + "[" + boxes[i].b + "] x " + boxes[j].n + "[" + boxes[j].b + "]");
      return r; });
    say(!!o.title && o.title[1] <= o.title[0] + 1, "the title fits its cell (" + (o.title ? o.title[1] + " in " + o.title[0] : "missing") + ")");
    say(o.side && o.side[1] <= o.side[0] + 1, "the side column does not overflow (" + (o.side ? o.side[1] + " in " + o.side[0] : "missing") + ")");
    say(o.wx && o.k2 && !(o.k2[0] < o.wx[2] - 2 && o.wx[0] < o.k2[2] - 2 && o.k2[1] < o.wx[3] - 2 && o.wx[1] < o.k2[3] - 2), "the weather caption box is clear of the picture: " + (o.k2 || "no caption") + " vs " + (o.wx || "no picture"));
    say(o.over.length === 0, "nothing overlaps (" + (o.over.length ? o.over.slice(0, 3).join(" ; ") : "0 pairs") + ")");
    var wq = (o.sent.w || "").split("_"), cq = (o.sent.c || "").split("_");
    say(o.wx && wq.length === 4 && +wq[2] === o.wx[0] && +wq[3] === o.wx[1], "the animation is drawn where the weather picture is: told " + o.sent.w + ", picture at " + (o.wx ? o.wx[0] + "," + o.wx[1] : "none"));
    var okd = o.digits.length === 6 && cq.length === 2 + 12;
    for (var i = 0; okd && i < 6; i++) okd = +cq[2 + i * 2] === o.digits[i][0] && +cq[3 + i * 2] === o.digits[i][1];
    say(okd, "the clock digits are drawn where the digits are: told " + o.sent.c + ", digits at " + o.digits.join(" "));
    say(!errs.length, "page errors: " + (errs.length ? errs.slice(0, 3).join(" ; ") : "none"));
    phantom.exit(bad ? 1 : 0);
  }, 1500);
}, 6500);
