// Kitchen Hub phone app, 9.8.5 additions: the FRIDGE tab (status, notes, remote control, log, TV + calendar links),
// chores (repeating), the meal plan and recipe import. Uses the globals of index.html (cfg, store, lockEdit, ...).
(function() {
  "use strict";
  var X = { brain: null, kindle: null, links: "" };
  try { var sv = JSON.parse(ls.get("kh_extras") || "null"); if (sv) X = sv; } catch (e) {}
  window.saveExtras = function(g) {
    var f = g.files || {};
    function j(n) { try { return f[n] && f[n].content ? JSON.parse(f[n].content) : null; } catch (e) { return null; } }
    X = { brain: j("brain.json"), kindle: j("kindle.json"), links: f["kindle.conf"] ? f["kindle.conf"].content : "" };
    ls.set("kh_extras", JSON.stringify(X));
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function put(kind, text, id, state) { store = lockEdit(store, id || HubData.newId("p"), kind, state || "open", text); ls.set(K.store, store); render(); syncSoon(400); }
  function ago(sec) { if (!sec) return "never"; var m = Math.round((Date.now() / 1000 - sec) / 60); return m < 2 ? "just now" : m < 90 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
  function pagesBase() { return location.origin + location.pathname.replace(/[^\/]*$/, ""); }
  // 10.9: the TV link is sealed (passphrase locked with a one-time code shown here, not in the link)
  var TVCODE = "";
  function tvLink() {
    var b = X.brain; if (!b || !b.tv) return "";
    if (!TVCODE) TVCODE = HubCrypt.pairCode(10);
    return pagesBase() + "tv.html#tv2=" + encodeURIComponent(HubCrypt.seal({ g: b.tv, k: pk(), k0: (cfg && cfg.k0) || "", m: (cfg && cfg.mon) || "" }, TVCODE));
  }
  function tvCode() { return TVCODE ? TVCODE.slice(0, 5) + "-" + TVCODE.slice(5) : ""; }
  function copy(text, el) {
    var done = function(t) { if (el) { var o = el.textContent; el.textContent = t; setTimeout(function() { el.textContent = o; }, 2500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function() { done("Copied"); }, function() { prompt("Copy", text); });
    else prompt("Copy", text);
  }

  // ---------- chores ----------
  window.repeatEvents = function(ev) {
    var reps = itemsOf("repeat").filter(function(it) { return it.state === "open" && !it.locked; });
    var x = HubCal.expandRepeats(reps, todayK(), 62);
    Object.keys(x).forEach(function(k) { x[k].forEach(function(e) { e.raw = null; (ev[k] = ev[k] || []).push(e); }); });
  };
  var DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function choreForm() {
    var box = $("c-chore");
    box.hidden = false;
    box.style.cssText = "margin-top:10px;border:2px solid var(--ink);padding:12px;background:#fff";
    var h = '<h2 style="margin-top:0">Repeating chore</h2><label class="fl">What<input id="ch-t" placeholder="Garbage + recycling out, Payday, Water plants"></label>' +
      '<label class="fl">How often<select id="ch-k"><option value="weekly">Every week on…</option><option value="every2w">Every 2 weeks</option><option value="monthly">Every month on day…</option><option value="last">Last day of the month</option><option value="yearly">Every year (birthday)</option><option value="daily">Every day</option></select></label>' +
      '<div id="ch-days" style="margin:6px 0">' + DN.map(function(d, i) { return '<label style="margin-right:10px;font-size:16px"><input type="checkbox" value="' + i + '"> ' + d + '</label>'; }).join("") + '</div>' +
      '<label class="fl" id="ch-dl">Starting / date<input type="date" id="ch-d"></label><label class="fl" id="ch-ml">Day of month<input type="number" min="1" max="31" id="ch-m" value="1"></label>' +
      '<label class="fl">Time (empty = all day; with a time your phone gets a push then)<input type="time" id="ch-tm"></label>' +
      (hasP2() ? '<label class="fl">Whose job<select id="ch-who"><option value="">Whoever</option><option value="rot">Take turns each week</option><option value="p1">' + esc(pName("p1")) + '</option><option value="p2">' + esc(pName("p2")) + '</option></select></label>' : "") +
      '<p class="row"><button class="btn" id="ch-save">Save</button><button class="btn ghost" id="ch-cancel">Cancel</button></p>' +
      '<h2>Your chores</h2><ul id="ch-list"></ul>';
    box.innerHTML = h;
    $("ch-d").value = todayK();
    function vis() { var k = $("ch-k").value; $("ch-days").hidden = k !== "weekly"; $("ch-dl").hidden = k !== "every2w" && k !== "yearly"; $("ch-ml").hidden = k !== "monthly"; }
    $("ch-k").addEventListener("change", vis); vis();
    $("ch-cancel").addEventListener("click", function() { box.hidden = true; });
    $("ch-save").addEventListener("click", function() {
      var t = $("ch-t").value.trim(), k = $("ch-k").value, d = $("ch-d").value, rule = "";
      if (!t) { $("ch-t").focus(); return; }
      if ((k === "every2w" || k === "yearly") && !/^\d{4}-\d\d-\d\d$/.test(d)) { alert("Pick a date first"); return; }     // 10.1.2: an empty date saved a broken chore
      if (k === "weekly") { var ds = [].slice.call(document.querySelectorAll("#ch-days input:checked")).map(function(c) { return c.value; }); if (!ds.length) { alert("Pick at least one day"); return; } rule = "weekly:" + ds.join(","); }
      else if (k === "every2w") { var p = d.split("-"); rule = "every2w:" + new Date(+p[0], +p[1] - 1, +p[2]).getDay() + ":" + d; }
      else if (k === "monthly") rule = "monthly:" + Math.max(1, Math.min(31, +$("ch-m").value || 1));
      else if (k === "last") rule = "monthly:last";
      else if (k === "yearly") rule = "yearly:" + d.slice(5);
      else rule = "daily";
      put("repeat", HubCal.repeatText(rule, $("ch-tm").value, t, "", $("ch-who") ? $("ch-who").value : ""));
      choreForm();
    });
    var ul = $("ch-list");
    itemsOf("repeat").filter(function(it) { return it.state === "open"; }).forEach(function(it) {
      var r = HubCal.parseRepeat(it.text), li = document.createElement("li");
      li.innerHTML = '<span class="txt"></span><button class="del">&times;</button>';
      li.querySelector(".txt").textContent = r ? r.title + " — " + HubCal.ruleLabel(r.rule) + (r.time ? " " + HubCal.fmtTime(r.time) : "") : it.text;
      li.querySelector(".del").addEventListener("click", function() { if (confirm("Stop this chore?")) { put("repeat", it.text, it.id, "del"); choreForm(); } });
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.innerHTML = '<li class="empty">None yet. Garbage night is a good first one.</li>';
  }
  $("c-addch").addEventListener("click", choreForm);

  // ---------- meal plan + import ----------
  // 10.4: the header note is its own line (it used to float inside the <h2>, and the list's top border ran through it),
  // and the dinner text gets a real flex width with wrapping (word-break:break-word made it one letter wide on iPhone).
  window.renderPlanImport = function() {
    var plan = {}, box = $("r-plan"), t = todayK(), h = '<h2>This week’s dinners</h2><p class="sub" style="margin:0 0 6px;font-size:13px;color:var(--mute)">The cloud brain fills empty days.</p><ul>';
    itemsOf("plan").forEach(function(it) { if (it.state === "open" && !it.locked) plan[it.text.slice(0, 10)] = it; });
    for (var i = 0; i < 7; i++) {
      var k = addD(t, i), it = plan[k];
      h += '<li data-k="' + k + '"><span class="k" style="width:92px;flex:none;font:800 12px/1.2 Arial;letter-spacing:.1em;text-transform:uppercase">' + (i === 0 ? "Tonight" : dayLabel(k)) + '</span><span class="txt" style="flex:1 1 auto;min-width:0;word-break:normal;overflow-wrap:anywhere">' + (it ? esc(it.text.split("|")[1]) : '<i style="color:var(--mute)">open</i>') + '</span>' + (it ? '<button class="del">&times;</button>' : "") + '</li>';
    }
    h += '</ul><p class="row"><button class="btn ghost" id="pl-roll">Re-roll the week</button><span class="wait">needs the GitHub kit</span></p>';
    box.innerHTML = h;
    [].forEach.call(box.querySelectorAll("li[data-k]"), function(li) {
      var k = li.getAttribute("data-k"), it = plan[k];
      li.addEventListener("click", function(e) {
        if (e.target.className === "del") { put("plan", it.text, it.id, "del"); return; }
        var rs = itemsOf("recipe").filter(function(r) { return r.state === "open" && !r.locked; }).map(function(r) { return r.text.split("\n")[0]; });
        var v = prompt("Dinner for " + dayLabel(k) + "?" + (rs.length ? "\nSaved: " + rs.slice(0, 12).join(", ") : ""), it ? it.text.split("|")[1] : "");
        if (v && v.trim()) put("plan", k + "|" + v.trim().replace(/\|/g, "/") + "|me", "m" + k.replace(/-/g, ""));
      });
    });
    $("pl-roll").addEventListener("click", function() { if (confirm("Pick new dinners for the coming week? (Days you set yourself are replaced too.)")) put("req", "replan"); });
    var ib = $("r-import"), reqs = itemsOf("req").filter(function(r) { return !r.locked && r.text.indexOf("import|") === 0; }).sort(function(a, b) { return b.ts - a.ts; }).slice(0, 4);
    ib.innerHTML = '<h2>Import a recipe from a link</h2><div class="row"><input id="im-u" placeholder="https://… (any recipe site with a recipe card)" style="flex:1;font-size:16px;padding:10px;border:2px solid var(--ink)"><button class="btn" id="im-go">Import</button></div><ul id="im-l" style="border:0"></ul>';
    reqs.forEach(function(r) {
      var f = r.text.split("|"), li = document.createElement("li");
      li.style.minHeight = "36px"; li.style.fontSize = "14px";
      li.textContent = r.state === "open" ? "Waiting for the cloud brain… " + f[1] : (f[2] === "ok" ? "✓ Imported: " + f[3] : "✗ " + (f[3] || "failed") + " — " + f[1]);
      $("im-l").appendChild(li);
    });
    $("im-go").addEventListener("click", function() {
      var u = $("im-u").value.trim();
      if (!/^https?:\/\/\S+$/.test(u)) { $("im-u").focus(); return; }
      put("req", "import|" + u); $("im-u").value = "";
    });
  };

  // ---------- the FRIDGE tab ----------
  window.renderFridge = function() {
    var box = $("app-f"), k = X.kindle, b = X.brain, h = "";
    h += '<h2>The fridge</h2>';
    if (k && k.ts) {
      // 10.10: the fridge reports in at its daily session (or when SYNC is tapped), not at every wake
      var daily = k.daily !== undefined && k.daily >= 0;
      var quiet = Date.now() / 1000 - k.ts > (daily ? 27 : Math.max(3, (k.interval || 60) * 3 / 60)) * 3600;
      h += '<div style="border:2px solid var(--ink);background:#fff;padding:12px;font-size:16px;line-height:1.5">' +
        '<div style="font:900 34px/1 Georgia,serif">' + (k.pct || "?") + '%' + (k.charging ? ' <span style="font-size:16px">charging</span>' : "") + '</div>' +
        (k.left7 > 0 && !k.charging ? 'About <b>' + (k.left7 >= 48 ? Math.round(k.left7 / 24) + " days" : k.left7 + " h") + '</b> left (' + k.rate7 + '%/h)<br>' : "") +
        'Checked in <b>' + ago(k.ts) + '</b>' + (quiet ? ' — <b>quiet longer than usual</b>' : "") + '<br>' +
        (daily ? 'Reports in daily at ' + ((k.daily % 12) || 12) + (k.daily < 12 ? ' am' : ' pm') + ' (or when you tap SYNC on it)' : 'Wakes every ' + (k.interval || "?") + ' min') + ' · version ' + esc(k.v) + ' · ' + (k.cloudData && Date.now() / 1000 - k.cloudData < 7200 ? "data from the cloud" : "fetches its own data") + '</div>';
      // 10.10: what the battery went on yesterday (Wi-Fi, wakes, the standby clock), from the fridge's energy report
      if (k.energy) h += '<div style="font-size:14px;margin-top:6px;line-height:1.45"><b>Yesterday\'s battery:</b> ' + esc(String(k.energy).replace(/^energy [0-9-]+: */, "")).replace(/ \| /g, " · ") + '</div>';
      // 10.2: updates on the fridge
      var ev = String(k.upd || "").split(" "), au = ["only when you tap", "tells you", "installs at night"][k.auto === undefined ? 2 : +k.auto] || "";
      h += '<div style="font-size:14px;margin-top:6px">Updates: <b>' + au + '</b>' + (k.avail ? ' · <b>' + esc(k.avail) + ' is ready</b>' : "") +
        (ev[1] === "rolledback" ? ' · last update (' + esc(ev[2] || "") + ') was undone, back on ' + esc(ev[3] || "") : ev[1] === "healthy" ? " · " + esc(ev[2] || "") + " running fine" : "") + '</div>';
    } else h += '<p class="empty">No check-in yet. The fridge reports in after its next sync (9.8.5 or newer).</p>';
    // 10.2: open a page in the fridge's web reader
    h += '<h2>Send a web page to the fridge</h2><div class="row"><input id="fw-u" inputmode="url" placeholder="https://… or search words" style="flex:1;font-size:17px;padding:10px;border:2px solid var(--ink)"><button class="btn" id="fw-go">Send</button></div>' +
      '<p style="font-size:13px;color:var(--mute);margin:4px 0 0">Opens as clean text in the fridge\'s WEB app. It reaches the fridge with its daily session, or right away when you tap SYNC on the fridge. Handy for a recipe or an article.</p>';
    h += '<p style="font-size:14px;color:var(--mute)">Cloud brain: ' + (b && b.lastRun ? "ran " + ago(b.lastRun / 1000) + (b.pushes ? " · sent " + b.pushes + " push" + (b.pushes > 1 ? "es" : "") : "") : 'not running — see GITHUB_SETUP.txt') + '</p>';
    // note
    var notes = itemsOf("msg").filter(function(m) { return !m.locked; }).sort(function(a, c) { return c.ts - a.ts; }).slice(0, 3);
    h += '<h2>Leave a note on the fridge</h2><div class="row"><input id="fn-t" maxlength="280" placeholder="Back at 6. Love you." style="flex:1;font-size:17px;padding:10px;border:2px solid var(--ink)"><button class="btn" id="fn-go">Pin</button></div>';
    notes.forEach(function(n) { h += '<div style="font-size:14px;margin-top:6px">' + (n.state === "open" ? "📌 " : "✓ read: ") + esc(n.text) + '</div>'; });
    // remote  (10.4: every timer button says its length in minutes)
    h += '<h2>Remote control</h2><p style="font-size:13px;color:var(--mute);margin:0 0 8px">Reaches the fridge with its daily session (or tap SYNC on the fridge to get it now).</p><div class="rc">' +
      '<button class="btn ghost" data-c="sync">Sync now</button><button class="btn ghost" data-c="timer|5">5 min</button><button class="btn ghost" data-c="timer|10">10 min</button><button class="btn ghost" data-c="timer|20">20 min</button><button class="btn ghost" data-c="timer|45">45 min</button>' +
      '<button class="btn ghost" data-c="update|check">Check update</button><button class="btn ghost" data-c="update|install">Install update</button><button class="btn ghost" data-c="update|rollback">Undo last update</button><button class="btn ghost" data-c="log">Send log</button>' +
      '<button class="btn ghost" data-c="screen|front">Front page</button><button class="btn ghost" data-c="screen|tiles">Tiles</button><button class="btn ghost" data-c="contrast|max">Max contrast</button><button class="btn ghost" data-c="contrast|normal">Normal</button><button class="btn ghost" data-c="reload">Reload page</button></div>';
    var cmds = itemsOf("cmd").filter(function(c) { return !c.locked; }).sort(function(a, c) { return c.ts - a.ts; }).slice(0, 3);
    cmds.forEach(function(c) { h += '<div style="font-size:13px;color:var(--mute)">' + (c.state === "open" ? "waiting: " : "done: ") + esc(c.text.split("|").slice(0, 2).join(" ")) + '</div>'; });
    // links
    var tv = tvLink(), ics = b && b.ics ? b.ics : "";
    h += '<h2>TV, PC and calendar</h2>';
    if (tv) h += '<p class="row"><a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(tv) + '" target="_blank">Open TV page</a><button class="btn ghost" id="tv-copy">Copy TV link</button></p>' +
      '<p style="font-size:14px">TV code: <b style="font-family:monospace;font-size:18px;letter-spacing:.06em">' + esc(tvCode()) + '</b> &mdash; the TV page asks for it once. It is not in the link, so send it separately.</p>';
    if (ics) h += '<p class="row"><a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="' + esc(ics.replace(/^https:/, "webcal:")) + '">Subscribe to calendar</a><button class="btn ghost" id="ics-copy">Copy link</button></p><p style="font-size:13px;color:var(--mute)">Shifts with times, events, chores and B.C. holidays, in the iPhone Calendar, Outlook or Google Calendar. Updates every 30 min. Anyone with the link can read it.</p>';
    if (!tv && !ics) h += '<p class="empty">These appear once the cloud brain has run (GITHUB_SETUP.txt).</p>';
    // 10.9: a new GitHub token: tested here, used by this phone at once, and handed to the fridge (locked in the gist)
    h += '<h2>New GitHub token</h2><p style="font-size:13px;color:var(--mute);margin:0 0 6px">Make it on github.com &rsaquo; Settings &rsaquo; Developer settings &rsaquo; Fine-grained tokens (Gists: read and write). Paste it here: this phone checks it, starts using it, and the fridge picks it up at its next sync. Then delete the old token on github.com and re-pair the PC.</p>' +
      '<div class="row"><input id="gt-t" type="password" autocomplete="off" placeholder="github_pat_…" style="flex:1;font-size:17px;padding:10px;border:2px solid var(--ink)"><button class="btn" id="gt-go">Replace</button></div><div id="gt-msg" style="font-size:14px;margin-top:4px"></div>';
    // log
    h += '<h2>Fridge log</h2><p class="row"><button class="btn ghost" id="lg-show">Show the last log</button><button class="btn ghost" id="pt-go">Test phone push</button></p><pre id="lg-box" style="white-space:pre-wrap;font-size:11px;max-height:340px;overflow:auto;border:1px solid var(--rule);padding:6px" hidden></pre>';
    box.innerHTML = h;
    $("fn-go").addEventListener("click", function() { var t = $("fn-t").value.trim(); if (t) { put("msg", t); } });
    $("fw-go").addEventListener("click", function() {
      var t = $("fw-u").value.trim(); if (!t) return;
      var u = /^https?:\/\//i.test(t) ? t : (!/\s/.test(t) && /\.[a-z]{2,}/i.test(t) ? "https://" + t : "q:" + t);
      put("cmd", "web|" + u.replace(/[\r\n]/g, "")); $("fw-u").value = ""; $("fw-go").textContent = "Sent";
    });
    [].forEach.call(box.querySelectorAll(".rc .btn"), function(bt) {
      bt.style.margin = "0 6px 6px 0";
      bt.addEventListener("click", function() { var c = bt.getAttribute("data-c"); if (c === "update|install" && !confirm("Install the update from your GitHub site? It reaches the fridge with its daily session or the next SYNC, and the hub restarts by itself.")) return; if (c === "update|rollback" && !confirm("Go back to the version the fridge had before its last update?")) return; put("cmd", c); });
    });
    if ($("tv-copy")) $("tv-copy").addEventListener("click", function() { copy(tv, $("tv-copy")); });
    $("gt-go").addEventListener("click", function() {
      var t = $("gt-t").value.trim(), msg = $("gt-msg");
      if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) { msg.textContent = "That doesn't look like a GitHub token."; return; }
      msg.textContent = "Checking…";
      timed(cfg.api + "/gists/" + cfg.gist, { headers: { Authorization: "Bearer " + t, Accept: "application/vnd.github+json" }, cache: "no-store" }, 15000).then(function(r) {
        if (!r.ok) { msg.textContent = "GitHub refused that token (" + r.status + "). It needs Gists: read and write."; return; }
        put("cfg", t, "ghtoken");                       // locked with the passphrase; the fridge takes it, then deletes it
        cfg.token = t; ls.set(K.cfg, JSON.stringify(cfg)); $("gt-t").value = "";
        msg.textContent = "Done. This phone uses the new token; the fridge picks it up at its next sync.";
      }, function() { msg.textContent = "Couldn't reach GitHub. Try again."; });
    });
    if ($("ics-copy")) $("ics-copy").addEventListener("click", function() { copy(ics, $("ics-copy")); });
    $("pt-go").addEventListener("click", function() { put("req", "pushtest"); $("pt-go").textContent = "Asked (next brain run)"; });
    $("lg-show").addEventListener("click", function() {
      var bx = $("lg-box"); bx.hidden = false; bx.textContent = "Loading…";
      if (!b || !b.cloudGist) { bx.textContent = "No cloud gist yet (the cloud brain makes it)."; return; }
      timed(cfg.api + "/gists/" + b.cloudGist, { headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" }, cache: "no-store" }, 15000)
        .then(function(r) { return r.json(); })
        .then(function(g) { var f = g.files && g.files["kindle-log.txt"]; bx.textContent = f ? f.content : "No log uploaded yet. Tap Send log above (or SEND LOG on the fridge)."; }, function() { bx.textContent = "Could not load the log."; });
    });
  };
  render();
})();
