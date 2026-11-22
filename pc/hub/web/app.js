/* Kitchen Hub v11 web app: phone layout + desktop mode (the PC control panel). Served by the hub on the PC. */
"use strict";
(function () {
    var $ = function (id) { return document.getElementById(id); };
    var LS = (function () { try { localStorage.setItem("kh_t", "1"); return localStorage; } catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; } })();
    var KEY = null; try { KEY = JSON.parse(LS.getItem("kh_key") || "null"); } catch (e) {}
    var STORE = LS.getItem("kh_store") || HubData.HEADER + "\n";
    var PENDING = []; try { PENDING = JSON.parse(LS.getItem("kh_pending") || "[]"); } catch (e) {}
    var ONLINE = false, TAB = "list";

    // ---------- signing (pure JS: crypto.subtle only exists on HTTPS, and the home address is plain HTTP) ----------
    var sha = HubCrypt.sha256, utf8 = HubCrypt.utf8;
    function hex(b) { var s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
    function unhex(h) { var o = []; for (var i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }
    function hmac(keyBytes, msgBytes) {
        var k = keyBytes.length > 64 ? sha(keyBytes) : keyBytes.slice(0), ip = [], op = [];
        while (k.length < 64) k.push(0);
        for (var i = 0; i < 64; i++) { ip.push(k[i] ^ 0x36); op.push(k[i] ^ 0x5c); }
        return sha(op.concat(sha(ip.concat(msgBytes))));
    }
    function call(method, path, body) {
        var h = {};
        body = body == null ? "" : (typeof body === "string" ? body : JSON.stringify(body));
        if (KEY) {
            var ts = String(Date.now());
            h["X-KH-Dev"] = KEY.id; h["X-KH-Ts"] = ts;
            h["X-KH-Sig"] = hex(hmac(unhex(KEY.secret), utf8(ts + "\n" + method + "\n" + path + "\n" + hex(sha(utf8(body))))));
        }
        return fetch(path, { method: method, headers: h, body: method === "GET" ? undefined : body, credentials: "same-origin" }).then(function (r) {
            return r.text().then(function (t) {
                var j = null; try { j = JSON.parse(t); } catch (e) {}
                if (!r.ok) { var e = new Error((j && j.error) || ("HTTP " + r.status)); e.status = r.status; throw e; }
                return j !== null ? j : t;
            });
        });
    }

    // ---------- pairing ----------
    function showPairing(msg) {
        $("app").classList.add("hidden"); $("pairing").classList.remove("hidden");
        var m = /#pair=([A-Za-z0-9]+)/.exec(location.hash); if (m) $("pair-code").value = m[1];
        if (msg) $("pair-msg").textContent = msg;
    }
    $("pair-go").onclick = function () {
        var kind = window.innerWidth >= 900 ? "computer" : "phone";
        call("POST", "/api/pair", { code: $("pair-code").value, name: $("pair-name").value || (kind === "phone" ? "Phone" : "Computer"), kind: kind })
            .then(function (r) { KEY = r; LS.setItem("kh_key", JSON.stringify(r)); history.replaceState(null, "", location.pathname); start(); })
            .catch(function (e) { $("pair-msg").textContent = e.message; });
    };

    // ---------- list ----------
    function saveLocal() { LS.setItem("kh_store", STORE); LS.setItem("kh_pending", JSON.stringify(PENDING)); }
    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
    function change(id, state, text) {
        var cur = STORE.split("\n"), ts = Date.now();
        for (var i = 0; i < cur.length; i++) { var it = HubData.parseLine(cur[i]); if (it && it.id === id && it.ts >= ts) ts = it.ts + 1; }
        var line = HubData.makeLine(ts, id, "shop", state, text);
        PENDING.push(line); STORE = HubData.merge([STORE, line], Date.now()); saveLocal(); renderList(); push();
    }
    function push() {
        if (!PENDING.length) return pull();
        var send = PENDING.slice();
        return call("POST", "/api/store", send.join("\n") + "\n").then(function (t) {
            PENDING = PENDING.slice(send.length); STORE = HubData.merge([t, PENDING], Date.now()); saveLocal(); setOnline(true); renderList();
        }).catch(function (e) { setOnline(false, e); renderList(); });
    }
    function pull() {
        return call("GET", "/api/store").then(function (t) { STORE = HubData.merge([t, PENDING], Date.now()); saveLocal(); setOnline(true); renderList(); })
            .catch(function (e) { setOnline(false, e); });
    }
    function renderList() {
        var open = "", done = "", its = HubData.items(STORE, "shop");
        its.forEach(function (it) {
            var s = HubCal.parseShop(it.text);
            var li = "<li data-id='" + esc(it.id) + "' data-text='" + esc(it.text) + "'><button class='tick' data-act='tick' aria-label='tick'></button><span class='t'>" + esc(s.name) +
                     (s.qty > 1 ? " <span class='n'>×" + s.qty + "</span>" : "") + (s.note ? " <span class='n'>" + esc(s.note) + "</span>" : "") +
                     "</span><button class='x' data-act='del' aria-label='delete'>✕</button></li>";
            if (it.state === "done") done = li + done; else open += li;
        });
        $("shop").innerHTML = open || "<li class='msg'>The list is empty.</li>";
        $("shop-done").innerHTML = done;
        $("pending").textContent = PENDING.length ? PENDING.length + " change(s) waiting to send - they go as soon as the PC is reachable (home Wi-Fi or Tailscale)." : "";
    }
    function listClick(e) {
        var b = e.target.closest("button[data-act]"); if (!b) return;
        var li = b.closest("li"), id = li.getAttribute("data-id"), text = li.getAttribute("data-text"), done = li.parentNode.id === "shop-done";
        if (b.getAttribute("data-act") === "del") change(id, "del", text); else change(id, done ? "open" : "done", text);
    }
    $("shop").onclick = listClick; $("shop-done").onclick = listClick;
    $("add").onsubmit = function (e) {
        e.preventDefault();
        var n = $("add-name").value.trim(); if (!n) return;
        var q = parseInt($("add-qty").value, 10) || 1;
        change(HubData.newId("w"), "open", HubCal.shopText(n, "", q, ""));
        $("add-name").value = ""; $("add-qty").value = 1; $("add-name").focus();
    };

    // ---------- status ----------
    function setOnline(on, e) {
        ONLINE = on;
        $("conn").textContent = on ? "Connected to the PC" : "Can't reach the PC" + (e && e.status ? " (" + e.message + ")" : " - showing the last copy");
        if (e && e.status === 401 && KEY) { KEY = null; LS.removeItem("kh_key"); showPairing("This device was unpaired. Pair it again."); }
    }
    function ago(t) { if (!t) return "never"; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
    function renderStatus() {
        call("GET", "/api/status").then(function (s) {
            setOnline(true);
            var c = function (k, v) { return "<div class='card'><span class='msg'>" + k + "</span><b>" + esc(v) + "</b></div>"; };
            $("status").innerHTML = c("Hub version", s.version) + c("Items in the store", s.items) + c("Fridge last seen", ago(s.kindleSeen)) +
                                    c("Waiting for the fridge", s.queue) + c("Paired devices", s.devices) + c("PC clock", new Date(s.time).toLocaleString());
        }).catch(function (e) { setOnline(false, e); $("status").innerHTML = "<p class='msg'>Can't reach the PC.</p>"; });
    }

    // ---------- desktop: virtual Kindle ----------
    var ROT = 0;
    function fitKindle() {
        var f = $("vk"), w = ROT % 180 ? 1648 : 1236, h = ROT % 180 ? 1236 : 1648;
        var avail = $("vk-wrap").clientWidth - 32, sc = Math.min(1, avail / w);
        f.style.width = w + "px"; f.style.height = h + "px"; f.style.transform = "scale(" + sc + ")";
        $("vk-wrap").style.height = (h * sc + 32) + "px"; $("vk-wrap").style.width = (w * sc + 32) + "px";
    }
    function openKindle() { call("POST", "/api/view").then(function () { $("vk").src = "/kindle/index.html?v=" + Date.now(); fitKindle(); }).catch(function (e) { setOnline(false, e); }); }
    $("vk-rot").onclick = function () { ROT = (ROT + 90) % 360; fitKindle(); };
    $("vk-reload").onclick = openKindle;

    // ---------- desktop: queue ----------
    function renderQueue() {
        call("GET", "/api/queue").then(function (q) {
            $("queue").innerHTML = q.slice().reverse().map(function (x) {
                return "<li><span class='t'>" + esc(x.action) + " <span class='n'>" + esc(x.state === "queued" ? "queued - delivered at the next wake" : x.state) + " · " + ago(x.at) + "</span></span>" +
                       (x.state === "queued" ? "<button class='x' data-q='" + esc(x.id) + "'>Cancel</button>" : "") + "</li>";
            }).join("") || "<li class='msg'>Nothing queued.</li>";
        }).catch(function (e) { setOnline(false, e); });
    }
    $("q-buttons").onclick = function (e) {
        var b = e.target.closest("button[data-a]"); if (!b) return;
        var a = b.getAttribute("data-a");
        if (a === "timer") { var m = prompt("Timer minutes (1-240)"); if (!m || !/^\d{1,3}$/.test(m)) return; a = "timer:" + m; }
        if (a === "note") { var n = prompt("Note for the fridge"); if (!n) return; a = "note:" + n.slice(0, 280); }
        call("POST", "/api/queue", { action: a }).then(renderQueue).catch(function (e2) { alert(e2.message); });
    };
    $("queue").onclick = function (e) { var b = e.target.closest("button[data-q]"); if (b) call("DELETE", "/api/queue/" + b.getAttribute("data-q")).then(renderQueue, renderQueue); };

    // ---------- desktop: devices ----------
    function qrSvg(text) {
        var q = qrcode(0, "M"); q.addData(unescape(encodeURIComponent(text))); q.make();
        var n = q.getModuleCount(), p = "";
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) p += "M" + c + " " + r + "h1v1h-1z";
        return "<svg viewBox='-2 -2 " + (n + 4) + " " + (n + 4) + "' width='100%' height='100%' shape-rendering='crispEdges'><rect x='-2' y='-2' width='" + (n + 4) + "' height='" + (n + 4) + "' fill='#fff'/><path d='" + p + "' fill='#000'/></svg>";
    }
    function renderDevices() {
        call("GET", "/api/devices").then(function (ds) {
            $("devices").innerHTML = ds.map(function (d) {
                return "<li><span class='t'>" + esc(d.name) + " <span class='n'>" + esc(d.kind) + " · last seen " + ago(d.seen) + (d.addr ? " · " + esc(d.addr) : "") + (KEY && KEY.id === d.id ? " · this device" : "") +
                       "</span></span><button class='x' data-ren='" + d.id + "'>Rename</button><button class='x' data-rev='" + d.id + "'>Remove</button></li>";
            }).join("") || "<li class='msg'>No devices paired yet.</li>";
        }).catch(function (e) { setOnline(false, e); });
    }
    $("devices").onclick = function (e) {
        var b = e.target.closest("button"); if (!b) return;
        if (b.dataset.rev && confirm("Remove this device? It will have to pair again.")) call("DELETE", "/api/devices/" + b.dataset.rev).then(renderDevices, renderDevices);
        if (b.dataset.ren) { var n = prompt("New name"); if (n) call("POST", "/api/devices/" + b.dataset.ren + "/name", { name: n }).then(renderDevices, renderDevices); }
    };
    $("pair-new").onclick = function () {
        call("POST", "/api/pair/code").then(function (c) {
            var link = location.origin + "/#pair=" + c.code;
            $("pair-box").classList.remove("hidden"); $("pair-show").textContent = c.code;
            $("pair-until").textContent = "Works until " + new Date(c.until).toLocaleTimeString() + ".";
            try { $("pair-qr").innerHTML = qrSvg(link); } catch (e) { $("pair-qr").innerHTML = ""; }
        }).catch(function (e) { alert(e.message); });
    };

    // ---------- layout + tabs ----------
    function applyLayout() {
        var forced = LS.getItem("kh_desktop");
        var desk = forced === "1" ? true : forced === "0" ? false : window.innerWidth >= 900;
        document.body.classList.toggle("desktop", desk); $("dm-switch").checked = desk;
        if (!desk && /kindle|queue|devices/.test(TAB)) show("list");
    }
    $("dm-switch").onchange = function () { LS.setItem("kh_desktop", this.checked ? "1" : "0"); applyLayout(); };
    function show(t) {
        TAB = t;
        Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) { b.classList.toggle("sel", b.getAttribute("data-tab") === t); });
        Array.prototype.forEach.call(document.querySelectorAll("main section"), function (s) { s.classList.toggle("hidden", s.id !== "tab-" + t); });
        if (t === "list") push(); if (t === "status") renderStatus(); if (t === "kindle") openKindle(); if (t === "queue") renderQueue(); if (t === "devices") renderDevices();
    }
    $("nav").onclick = function (e) { var b = e.target.closest("button[data-tab]"); if (b) show(b.getAttribute("data-tab")); };
    window.addEventListener("resize", function () { applyLayout(); if (TAB === "kindle") fitKindle(); });

    function start() {
        $("pairing").classList.add("hidden"); $("app").classList.remove("hidden");
        applyLayout(); renderList(); show(TAB);
    }
    // the PC itself needs no key; anyone else needs one
    call("GET", "/api/status").then(start).catch(function (e) {
        if (e.status === 401 && !/#pair=/.test(location.hash) && KEY) { KEY = null; LS.removeItem("kh_key"); }
        if (e.status === 401 || /#pair=/.test(location.hash)) showPairing(); else start();     // offline: show the last copy
    });
    setInterval(function () { if (!document.hidden && TAB === "list") push(); if (!document.hidden && TAB === "queue") renderQueue(); }, 20000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && TAB === "list") push(); });
})();
