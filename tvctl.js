/* Kitchen Hub 10.9 — the kitchen monitor: remote control from the Kindle, scenes, and a see-through look.
 * Loaded by tv.html after its own script. The Kindle sends commands to your private ntfy channel (CFG.m, from the
 * sealed TV pairing code); each one is locked with your passphrase and carries its time and a counter, so only
 * your devices can send them and an old one can't be played again.
 *   scene dash|clock|menu|off   timer <end ms>|<minutes>   slide <name>   go 1|-1   pause 1|0
 *   cook <recipe title> ("" = stop)   step 1|-1   theme glass|dark|light|auto
 * See-through: black is clear glass on a transparent screen, so the look is black with warm, bright type.
 */
(function() {
  var css = document.createElement("style");
  css.textContent =
    "body.glass { --bg: #000; --ink: #ffe9c4; --mute: #ffb04a; --rule: #4a3112; --hi: #fff6e6; --card: #000; }" +
    "body.glass .wd, body.glass .days div, body.glass .chips span { border-color: #4a3112; }" +
    "body.glass .clock { text-shadow: 0 0 2vw rgba(255, 176, 74, .25); }" +
    "#scn { position: absolute; inset: 0; background: var(--bg); display: none; z-index: 5; padding: 4vh 5vw; }" +
    "#scn.off { background: #000; cursor: none; }" +
    "#scn .big-clock { font-weight: 900; font-size: 24vw; line-height: .9; letter-spacing: -.04em; text-align: center; margin-top: 6vh; white-space: nowrap; }" +
    "#scn .big-clock small { font-size: .22em; letter-spacing: .04em; margin-left: .2em; }" +
    "#scn .sub { text-align: center; font-size: 3vw; font-style: italic; margin-top: 2vh; color: var(--mute); }" +
    "#scn .tmr { font-weight: 900; font-size: 30vw; line-height: 1; text-align: center; margin-top: 8vh; font-variant-numeric: tabular-nums; }" +
    "#scn .tmr.done { color: var(--hi); }" +
    "#scn .board { max-width: 70vw; margin: 0 auto; border: .6vh double var(--mute); padding: 3vh 4vw; }" +
    "#scn .board h1 { margin: 0; text-align: center; font-size: 5.5vw; letter-spacing: .18em; text-transform: uppercase; }" +
    "#scn .board h2 { margin: 3vh 0 1vh; text-align: center; font: 800 1.6vw Helvetica, Arial, sans-serif; letter-spacing: .3em; color: var(--mute); text-transform: uppercase; }" +
    "#scn .board .tonight { text-align: center; font-size: 4.5vw; font-style: italic; }" +
    "#scn .board .row { display: flex; font-size: 2.4vw; margin: 1vh 0; } #scn .board .row b { font: 800 1.8vw Helvetica, Arial, sans-serif; letter-spacing: .12em; width: 6vw; color: var(--mute); }" +
    "#scn .board .row span { flex: 1; border-bottom: .3vh dotted var(--rule); margin: 0 1vw .8vh; } #scn .board .row i { font-style: normal; }" +
    "#rmt { position: absolute; right: 2.6vw; top: .6vh; font: 700 .9vw Helvetica, Arial, sans-serif; letter-spacing: .14em; color: var(--mute); z-index: 6; }";
  document.head.appendChild(css);
  var scn = document.createElement("div"); scn.id = "scn"; document.body.appendChild(scn);
  var rmt = document.createElement("div"); rmt.id = "rmt"; document.body.appendChild(rmt);
  try { if (CFG.theme) THEME = CFG.theme; } catch (e) {}

  // ---------- the see-through look (THEME "glass"), kept after every rebuild ----------
  var plainBuild = build;
  build = function() { plainBuild(); if (THEME === "glass") document.body.className = "glass" + (slidesList()[0] === "night" ? " night" : ""); };
  window.addEventListener("keydown", function(e) {      // G: see-through look on/off (D still cycles auto, light, dark)
    if (e.key === "g" || e.key === "G") { THEME = THEME === "glass" ? "auto" : "glass"; saveTheme(); build(); e.preventDefault(); }
  });
  function saveTheme() { CFG.theme = THEME; try { localStorage.setItem("kh_tv", JSON.stringify(CFG)); } catch (e) {} }

  // ---------- scenes: full-screen views on top of the slides ----------
  var SCENE = { name: "", timerEnd: 0, timerMin: "" }, tick = null;
  function scene(name) {
    SCENE.name = name === "dash" ? "" : name;
    clearInterval(tick); tick = null;
    scn.className = SCENE.name === "off" ? "off" : "";
    scn.style.display = SCENE.name ? "block" : "none";
    drawScene();
    if (SCENE.name === "timer" || SCENE.name === "clock") tick = setInterval(drawScene, 1000);
  }
  function drawScene() {
    var n = now(), h = n.getUTCHours(), k = keyOf(n);
    if (SCENE.name === "off") { scn.innerHTML = ""; return; }
    if (SCENE.name === "clock") {
      var t = D && D.weather && D.weather.now ? Math.round(D.weather.now.temperature_2m) + "° · " + esc(WMO[D.weather.now.weather_code] || "") : "";
      scn.innerHTML = '<div class="big-clock">' + (h % 12 || 12) + ":" + p2(n.getUTCMinutes()) + "<small>" + (h >= 12 ? "PM" : "AM") + "</small></div>" +
        '<div class="sub">' + DAYS[n.getUTCDay()] + ", " + MON[n.getUTCMonth()] + " " + n.getUTCDate() + (t ? " · " + t : "") +
        (D && D.plan && D.plan[k] ? "<br>Tonight: " + esc(D.plan[k]) : "") + "</div>";
      return;
    }
    if (SCENE.name === "timer") {
      var left = Math.max(0, Math.round((SCENE.timerEnd - Date.now()) / 1000)), done = left === 0;
      scn.innerHTML = '<div class="tmr' + (done ? " done" : "") + '">' + (done ? "DONE" : Math.floor(left / 60) + ":" + p2(left % 60)) + "</div>" +
        '<div class="sub">' + (done ? "Timer's up" : (SCENE.timerMin ? SCENE.timerMin + " minute timer" : "Timer")) + "</div>";
      if (done && Date.now() - SCENE.timerEnd > 10 * 60000) scene("dash");      // back to the dashboard 10 min after it rang
      return;
    }
    if (SCENE.name === "menu") {
      var b = '<div class="board"><h1>The Kitchen</h1><h2>Tonight</h2><div class="tonight">' + esc((D && D.plan && D.plan[k]) || "Chef's choice") + "</div><h2>This week</h2>";
      for (var i = 1; i < 7; i++) { var d = addK(k, i); if (D && D.plan && D.plan[d]) b += '<div class="row"><b>' + DAYS[dow(d)].slice(0, 3).toUpperCase() + "</b><i>" + esc(D.plan[d]) + "</i><span></span></div>"; }
      if (D && D.list && D.list.length) b += "<h2>On the list</h2><div class=\"tonight\" style=\"font-size:2.2vw\">" + esc(D.list.slice(0, 8).join(" · ")) + "</div>";
      scn.innerHTML = b + "</div>";
    }
  }
  document.addEventListener("keydown", function(e) { if (SCENE.name) { scene("dash"); e.stopPropagation(); e.preventDefault(); } }, true);    // any key closes a scene

  // ---------- commands ----------
  function run(m) {
    var c = m.c, a = m.a;
    if (c === "scene") scene(String(a));
    else if (c === "timer") { var p = String(a).split("|"); SCENE.timerEnd = +p[0] || 0; SCENE.timerMin = p[1] || ""; scene("timer"); }
    else if (c === "slide") { scene("dash"); var L = slidesList(), i = L.indexOf(String(a)); if (i >= 0) { SL = i; build(); } }
    else if (c === "go") { scene("dash"); go(+a < 0 ? -1 : 1); }
    else if (c === "pause") { PAUSE = !!+a; build(); }
    else if (c === "cook") {
      scene("dash");
      if (!a) { COOK = null; cookDraw(); return; }
      var rs = (D && D.recipes) || [], t = String(a).toLowerCase(), j;
      for (j = 0; j < rs.length; j++) if (String(rs[j].title).toLowerCase() === t) break;
      if (j < rs.length) { COOK = { pick: j, r: rs[j], step: rs[j].ing.length ? -1 : 0 }; cookDraw(); }
    }
    else if (c === "step") { if (COOK && COOK.r) { COOK.step = Math.max(-1, Math.min(COOK.r.steps.length - 1, COOK.step + (+a < 0 ? -1 : 1))); cookDraw(); } }
    else if (c === "theme" && /^(glass|dark|light|auto)$/.test(a)) { THEME = a; saveTheme(); build(); }
  }
  var LAST = { t: 0, n: 0 };
  try { var l = JSON.parse(localStorage.getItem("kh_mon_last") || "{}"); LAST.t = +l.t || 0; LAST.n = +l.n || 0; } catch (e) {}
  function accept(text) {
    var j = unlockTV(String(text || "")), m;
    if (j === null || j === text) return;                     // not locked with our passphrase: ignored
    try { m = JSON.parse(j); } catch (e) { return; }
    if (!m || typeof m.c !== "string" || typeof m.t !== "number") return;
    if (Math.abs(Date.now() - m.t) > 5 * 60000) return;      // too old (or a clock far off)
    if (m.t < LAST.t || (m.t === LAST.t && (+m.n || 0) <= LAST.n)) return;      // seen already: no replays
    LAST.t = m.t; LAST.n = +m.n || 0;
    try { localStorage.setItem("kh_mon_last", JSON.stringify(LAST)); } catch (e) {}
    run(m);
  }
  window.khMonitorAccept = accept;                             // (tests)
  function listen() {
    if (!CFG.m || !/^khscreen-[0-9a-f]{20}$/.test(CFG.m) || !window.EventSource) { rmt.textContent = ""; return; }
    var es = new EventSource("https://ntfy.sh/" + CFG.m + "/sse");
    es.onopen = function() { rmt.textContent = "REMOTE ON"; };
    es.onerror = function() { rmt.textContent = "REMOTE RECONNECTING"; };
    es.onmessage = function(e) { try { var d = JSON.parse(e.data); if (d.event === "message") accept(d.message); } catch (x) {} };
  }
  listen();
})();
