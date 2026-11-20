/* Kitchen Hub 10.9 — loaded after the main page script (index.html). ES5 only: the Kindle's browser is old.
 *
 *  1. Authenticator (TOTP, RFC 6238): a 6-digit code from Google/Microsoft Authenticator guards pairing codes,
 *     the first cloud connection, new keys and hub mode. The secret is made on the Kindle (mesquite/totp.js).
 *  2. Keys: items locked with the passphrase from before a key change still open (pass0); after MAKE NEW KEYS
 *     they are re-locked with the new one and sent on to the cloud.
 *  3. Sealed pairing codes: the QR carries gist, token and passphrase locked with a one-time code that is shown
 *     next to it, never inside it. The shopping-list QR only opens the app (no secrets in it any more).
 *  4. A new GitHub token handed over by the phone (cfg item "ghtoken", locked in the gist).
 */

// ===================== 1. AUTHENTICATOR (SHA-1 / HMAC / base32 / TOTP) =====================
var HubTotp = (function() {
    function rol(x, n) { return (x << n) | (x >>> (32 - n)); }
    function sha1(m) {            // bytes -> 20 bytes
        var b = m.slice(0), l = m.length, i, j, w = [], H = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
        b.push(0x80); while (b.length % 64 !== 56) b.push(0);
        var bits = l * 8;
        b.push(0, 0, 0, Math.floor(bits / 4294967296) & 255, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
        for (i = 0; i < b.length; i += 64) {
            for (j = 0; j < 16; j++) w[j] = (b[i + 4 * j] << 24) | (b[i + 4 * j + 1] << 16) | (b[i + 4 * j + 2] << 8) | b[i + 4 * j + 3];
            for (j = 16; j < 80; j++) w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
            var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f, k, t;
            for (j = 0; j < 80; j++) {
                if (j < 20) { f = (bb & c) | (~bb & d); k = 0x5A827999; }
                else if (j < 40) { f = bb ^ c ^ d; k = 0x6ED9EBA1; }
                else if (j < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC; }
                else { f = bb ^ c ^ d; k = 0xCA62C1D6; }
                t = (rol(a, 5) + f + e + k + w[j]) | 0; e = d; d = c; c = rol(bb, 30); bb = a; a = t;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
        }
        var out = [];
        for (i = 0; i < 5; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
        return out;
    }
    function hmac(key, msg) {
        if (key.length > 64) key = sha1(key);
        var ip = [], op = [], i;
        for (i = 0; i < 64; i++) { var kb = key[i] || 0; ip.push(kb ^ 0x36); op.push(kb ^ 0x5c); }
        return sha1(op.concat(sha1(ip.concat(msg))));
    }
    function b32(s) {
        var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", out = [], buf = 0, bits = 0, i, v;
        s = String(s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
        for (i = 0; i < s.length; i++) { v = A.indexOf(s.charAt(i)); buf = (buf << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; out.push((buf >>> bits) & 255); buf &= (1 << bits) - 1; } }
        return out;
    }
    function code(secret, step) {
        var msg = [0, 0, 0, 0, (step >>> 24) & 255, (step >>> 16) & 255, (step >>> 8) & 255, step & 255];
        var h = hmac(b32(secret), msg), o = h[19] & 15;
        var n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
        var s = String(n % 1000000); while (s.length < 6) s = "0" + s;
        return s;
    }
    // a code from 30 s before to 30 s after now is accepted (phone and Kindle clocks drift a little)
    function verify(secret, c, nowMs) {
        c = String(c || "").replace(/\D/g, "");
        if (c.length !== 6 || !secret) return false;
        var step = Math.floor((nowMs || new Date().getTime()) / 30000);
        for (var d = -1; d <= 1; d++) if (code(secret, step + d) === c) return true;
        return false;
    }
    return { sha1: sha1, hmac: hmac, b32: b32, code: code, verify: verify };
})();

// ===================== 2. KEYS: the passphrase before the last key change still opens things =====================
function passKeys() { var C = window.HUB_CLOUD || {}; return [C.pass || "", C.pass0 || ""]; }
(function() {
    var plainUnlock = HubCrypt.unlock;
    HubCrypt.unlock = function(text, pass) {
        var r = plainUnlock(text, pass), C = window.HUB_CLOUD || {};
        if (r === null && C.pass0 && pass === (C.pass || "")) r = plainUnlock(text, C.pass0);
        return r;
    };
    HubCrypt.unlockNew = plainUnlock;      // only the current passphrase (re-locking needs to know which one opened it)
})();
// after MAKE NEW KEYS: everything still locked with the old passphrase is locked again with the new one and
// handed to the loop (which syncs it), so the phone, the cloud and the TV only need the new one afterwards
var RELOCK_RUN = 0;
function relockOld() {
    var C = window.HUB_CLOUD || {};
    if (!C.pass || !C.pass0) return 0;
    var lines = HubData.items(STORE), n = 0, i, it, t;
    for (i = 0; i < lines.length; i++) {
        it = lines[i];
        if (!HubCrypt.isLocked(it.text) || HubCrypt.unlockNew(it.text, C.pass) !== null) continue;
        t = HubCrypt.unlockNew(it.text, C.pass0);
        if (t === null) continue;
        queueLines([storeEdit(it.id, it.kind, it.state, t)]); n++;
    }
    if (n) { storeSave(); RELOCK_RUN += n; diagOnce("re-locked " + n + " item(s) with the new passphrase"); }
    return n;
}
function oldLockedLeft() {
    var C = window.HUB_CLOUD || {};
    if (!C.pass0) return 0;
    var lines = HubData.items(STORE), n = 0;
    for (var i = 0; i < lines.length; i++) if (HubCrypt.isLocked(lines[i].text) && HubCrypt.unlockNew(lines[i].text, C.pass) === null && HubCrypt.unlockNew(lines[i].text, C.pass0) !== null) n++;
    return n;
}

// ===================== 3. THE GATE: a fresh authenticator code opens security actions for 5 minutes =====================
var SEC = { until: 0, fails: 0, waitUntil: 0 };
function secNow() { return new Date().getTime(); }
function secOn() { var T = window.HUB_TOTP || {}; return !!(T.secret && T.on); }
function secGate(why, then) {
    var T = window.HUB_TOTP || {};
    if (!T.secret) { secBox("<div class='hv-lbl'>Authenticator not ready</div><div class='hv-hint'>The hub makes the authenticator secret when it starts. Exit the hub and start it again, then try once more.</div>"); return; }
    if (!T.on) { secSetup(then); return; }
    if (SEC.until > secNow() && !HUB.sleeping) { then(); return; }
    (function ask(note) {
        if (SEC.waitUntil > secNow()) note = "Too many tries. Wait " + Math.ceil((SEC.waitUntil - secNow()) / 1000) + " s.";
        pinAsk(esc(why), function(c) {
            if (c === null) return;
            if (SEC.waitUntil > secNow()) return ask();
            if (HubTotp.verify(T.secret, c)) { SEC.fails = 0; SEC.until = secNow() + 5 * 60000; then(); return; }
            if (++SEC.fails >= 5) { SEC.fails = 0; SEC.waitUntil = secNow() + 60000; }
            ask("Wrong code &mdash; use the newest one in your authenticator app.");
        }, note || "Authenticator code (6 digits)");
    })();
}
// everything opened by a code closes when the hub goes to standby
var __lockAll109 = lockAll;
lockAll = function() { __lockAll109(); SEC.until = 0; };

// ---------- a simple box over the screen (inside #root, so it turns with the screen) ----------
(function() {
    var el = document.createElement("div"); el.id = "sec-box";
    el.style.cssText = "display:none;position:absolute;z-index:390;background:#fff;border:6px double #000;padding:1em;box-sizing:border-box;overflow:hidden;font-family:Helvetica,Arial,sans-serif";
    $("root").appendChild(el);
})();
function secBox(html, wide) {
    var el = $("sec-box");
    el.innerHTML = "<div style='text-align:right'><span class='opt-btn big' id='sec-x'>CLOSE</span></div><div id='sec-in'>" + html + "</div>";
    el.style.display = "block";
    var w = Math.round(W * (wide ? 0.9 : 0.76)), h = Math.round(H * 0.84);
    place(el, Math.round((W - w) / 2), Math.round(H * 0.06), w, h);
    bindTap($("sec-x"), secBoxClose);
    try { fitText($("sec-in"), 9, FS * 1.15); } catch (e) {}
}
function secBoxClose() { var el = $("sec-box"); el.style.display = "none"; el.innerHTML = ""; if (HUB_OPEN && curTab === "security") renderSecurityPane(); }

// ---------- one-time setup: the QR for the authenticator app, then one code to prove it works ----------
function secSetup(then) {
    var T = window.HUB_TOTP || {};
    var uri = "otpauth://totp/Kitchen%20Hub:Kindle?secret=" + T.secret + "&issuer=Kitchen%20Hub&digits=6&period=30";
    var grouped = T.secret.replace(/(....)/g, "$1 ").replace(/\s+$/, "");
    secBox("<div class='hv-lbl'>Set up the authenticator</div>" +
        "<div style='display:table;width:100%'><div style='display:table-cell;width:46%;vertical-align:top'><div style='width:100%'>" + qrSvg(uri) + "</div></div>" +
        "<div style='display:table-cell;vertical-align:top;padding-left:1em'><div class='hv-hint' style='font-size:1em;line-height:1.45'>" +
        "1. On your phone, open <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> and add an account with the camera (or 'enter a setup key').<br>" +
        "2. Scan this code. Setup key, if typing: <b style='letter-spacing:.08em'>" + esc(grouped) + "</b><br>" +
        "3. Tap <b>ENTER CODE</b> and type the 6 digits it shows.<br><br>" +
        "From then on, pairing codes, the first cloud connection, new keys and hub mode need a fresh code. " +
        "Keep the authenticator on your phone backed up: without it you'd have to reinstall the hub to change these.</div>" +
        "<div style='margin-top:1em'><span class='opt-btn big sel' id='sec-enter'>ENTER CODE</span></div></div></div>", true);
    bindTap($("sec-enter"), function() {
        (function ask(note) {
            pinAsk("Code from the app", function(c) {
                if (c === null) return;
                if (!HubTotp.verify(T.secret, c)) return ask("That code didn't match &mdash; check the phone's clock and try the newest code.");
                sendPower("totpon=1", function(r) {
                    if (r !== "ok") { secBox("<div class='hv-lbl'>Couldn't save</div><div class='hv-hint'>The hub's background loop didn't answer. Try again in a moment.</div>"); return; }
                    T.on = 1; SEC.until = secNow() + 5 * 60000; secBoxClose();
                    if (then) then();
                });
            }, note || "6 digits");
        })();
    });
}

// ===================== 4. SEALED PAIRING CODES =====================
function sealSeed() { return (window.HUB_PORTKEY || "") + "|" + ((window.HUB_TOTP || {}).secret || ""); }
function fmtCode(c) { return c.substring(0, 5) + "-" + c.substring(5); }
// what: "phone" (you), "p2" (the second person's phone), "tv" (TV / kitchen monitor), "pc"
function sealedLink(what) {
    var C = window.HUB_CLOUD || {}, pg = pagesUrl(C.pages);
    if (!pg) return null;
    var code = HubCrypt.pairCode(10, sealSeed()), p;
    if (what === "tv") {
        if (!C.tv) return null;
        p = { g: C.tv, k: C.pass || "", k0: C.pass0 || "", m: C.mon || "" };
        return { url: pg + "tv.html#tv2=" + encodeURIComponent(HubCrypt.seal(p, code)), code: code };
    }
    if (!C.gist || !C.token || /paste_/.test(C.gist + C.token)) return null;
    p = { g: C.gist, t: C.token, k: C.pass || "", k0: C.pass0 || "", w: what === "p2" ? "p2" : "p1", n: C.ntfy || "", m: C.mon || "" };
    return { url: pg + "#pair2=" + encodeURIComponent(HubCrypt.seal(p, code)), code: code };
}
function showPairing(what) {
    var s = sealedLink(what), who = what === "tv" ? "the TV or kitchen monitor" : what === "p2" ? esc(pName("p2")) + "&rsquo;s phone" : "your phone or PC";
    if (!s) {
        secBox("<div class='hv-lbl'>Not ready</div><div class='hv-hint'>" + (what === "tv" ? "The TV code appears after the cloud brain's first run." :
            "cloud.conf needs GIST_ID, GH_TOKEN and PAGES_URL first (your repo address works for PAGES_URL).") + "</div>");
        return;
    }
    secBox("<div class='hv-lbl'>Pair " + who + "</div>" +
        "<div style='display:table;width:100%'><div style='display:table-cell;width:50%;vertical-align:top'>" + qrSvg(s.url) + "</div>" +
        "<div style='display:table-cell;vertical-align:top;padding-left:1em'>" +
        "<div class='hv-hint' style='font-size:1em;line-height:1.45'>1. Scan with the camera (or open the link on the PC: <b>kh pair</b> and paste it).<br>" +
        "2. When it asks, type this code:</div>" +
        "<div style='font-size:2.6em;font-weight:900;letter-spacing:.12em;margin:.4em 0;font-family:Courier,monospace;white-space:nowrap'>" + fmtCode(s.code) + "</div>" +
        "<div class='hv-hint'>The code is only on this screen and works for this QR only. Someone who gets the link alone can't use it. " +
        "Closing this box forgets the code.</div></div></div>", true);
}

// ===================== 5. THE SECURITY TAB =====================
(function() {
    var tabs = $("hv-tabs"), t = document.createElement("div");
    t.className = "hv-tab"; t.setAttribute("data-tab", "security"); t.innerHTML = "Security";
    var logTab = null, all = tabs.getElementsByTagName("div");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-tab") === "log") logTab = all[i];
    tabs.insertBefore(t, logTab);
    tabs.className += " hv-tabs-many";
    var pane = document.createElement("div"); pane.className = "hv-pane"; pane.id = "pane-security"; pane.style.display = "none";
    $("hv-wrap").appendChild(pane);
    var css = document.createElement("style");
    css.innerHTML = ".hv-tabs-many .hv-tab { letter-spacing: .05em; font-size: .78em; padding-left: .1em; padding-right: .1em; }" +
        ".sec-row { padding: .45em 0; border-bottom: 2px solid #000; } .sec-row:last-child { border-bottom: 0; }" +
        ".sec-st { font-weight: 900; } .sec-warn { border: 4px solid #000; padding: .5em; margin: .4em 0; font-weight: bold; }";
    document.getElementsByTagName("head")[0].appendChild(css);
    bindTap(t, function() { selectTab("security"); });
})();
var __selectTab109 = selectTab;
selectTab = function(name) {
    $("pane-security").style.display = "none";
    if (name !== "security") { __selectTab109(name); return; }
    __selectTab109("log");                 // closes whatever was open; then swap the log pane for ours
    curTab = "security";
    $("pane-log").style.display = "none";
    var tabs = $("hv-tabs").getElementsByTagName("div");
    for (var i = 0; i < tabs.length; i++) tabs[i].className = "hv-tab" + (tabs[i].getAttribute("data-tab") === "security" ? " sel" : "");
    $("pane-security").style.display = "block";
    loadScript("cloud.js", function() { if (curTab === "security" && HUB_OPEN) renderSecurityPane(); });
    loadScript("totp.js", function() { if (curTab === "security" && HUB_OPEN) renderSecurityPane(); });
    renderSecurityPane();
    if (typeof HVS !== "undefined") HVS.sig = "";
};
function secBtn(id, label, sel) { return "<span class='opt-btn big" + (sel ? " sel" : "") + "' id='" + id + "'>" + label + "</span> "; }
function renderSecurityPane() {
    var p = $("pane-security"), C = window.HUB_CLOUD || {}, h = "", has = !!(C.gist && C.token && !/paste_/.test(C.gist + C.token));
    if (C.legacy) h += "<div class='sec-warn'>Your lists are locked with the old built-in passphrase that every Kitchen Hub shared before 10.9. Tap MAKE NEW KEYS below.</div>";
    h += "<div class='sec-row'><div class='hv-lbl'>Authenticator</div><span class='sec-st'>" + (secOn() ? "On" : "Not set up") + "</span>" +
         "<div class='hv-hint'>A 6-digit code from Google or Microsoft Authenticator on your phone guards pairing, the first cloud connection, new keys and hub mode.</div>" +
         (secOn() ? "" : "<div>" + secBtn("sec-setup", "SET UP", true) + "</div>") + "</div>";
    h += "<div class='sec-row'><div class='hv-lbl'>Cloud</div>";
    if (!has) h += "<span class='sec-st'>Not set up</span><div class='hv-hint'>Lists work on the fridge alone. For the phone, add cloud.conf (GITHUB_SETUP.txt).</div>";
    else if (!C.cok) h += "<span class='sec-st'>Waiting for you</span><div class='hv-hint'>cloud.conf is here, but the first connection needs an authenticator code.</div><div>" + secBtn("sec-cloud", "CONNECT", true) + "</div>";
    else h += "<span class='sec-st'>Connected</span>";
    h += "</div>";
    h += "<div class='sec-row'><div class='hv-lbl'>Pair a device</div><div class='hv-hint'>Each code is new, shown only here, and works with its own QR only.</div><div>" +
         secBtn("sec-pp", "PHONE OR PC") + (hasP2() ? secBtn("sec-p2", esc(pName("p2")).toUpperCase() + "&rsquo;S PHONE") : "") + secBtn("sec-tv", "TV / MONITOR") + "</div></div>";
    h += "<div class='sec-row'><div class='hv-lbl'>Keys</div>";
    if (C.pass0) {
        var left = oldLockedLeft();
        h += "<span class='sec-st'>Changing keys" + (C.keysAt ? " (since " + new Date(C.keysAt * 1000).toDateString() + ")" : "") + "</span>" +
             "<div class='hv-hint'>" + (left ? left + " item(s) still locked with the old passphrase &mdash; they move over at the next lists sync. " : "Everything here uses the new passphrase. ") +
             "Re-pair the phone, PC and TV, update the GitHub secrets (GITHUB STEPS), then FINISH.</div><div>" +
             secBtn("sec-steps", "GITHUB STEPS") + secBtn("sec-done", "FINISH", true) + "</div>";
    } else {
        h += "<div class='hv-hint'>New passphrase, alert channel and monitor channel, made here from the Kindle's random source. Afterwards you re-pair the phone, PC and TV and update two GitHub secrets (step-by-step on screen).</div>" +
             "<div>" + secBtn("sec-new", "MAKE NEW KEYS") + (C.keysAt ? secBtn("sec-steps", "GITHUB STEPS") : "") + "</div>";
    }
    h += "</div>";
    h += "<div class='sec-row'><div class='hv-lbl'>GitHub token</div><div class='hv-hint'>To replace it: make a new token on github.com (Gists: read and write), paste it in the phone app under Fridge &rsaquo; New GitHub token. The Kindle picks it up at the next sync; then delete the old token on github.com.</div></div>";
    p.innerHTML = h;
    function on(id, f) { var e = $(id); if (e) bindTap(e, f); }
    on("sec-setup", function() { secSetup(function() { renderSecurityPane(); }); });
    on("sec-cloud", function() { secGate("Connect to the cloud", function() { sendPower("cloudok=1", function() { loadScript("cloud.js", function() { renderSecurityPane(); }); }); }); });
    on("sec-pp", function() { secGate("Show a pairing code", function() { showPairing("phone"); }); });
    on("sec-p2", function() { secGate("Show a pairing code", function() { showPairing("p2"); }); });
    on("sec-tv", function() { secGate("Show a pairing code", function() { showPairing("tv"); }); });
    on("sec-new", function() { secGate("Make new keys", function() {
        secBox("<div class='hv-lbl'>Make new keys?</div><div class='hv-hint' style='font-size:1em;line-height:1.45'>The Kindle makes a new passphrase, alert channel and monitor channel. Nothing is lost: things locked with the old passphrase still open until you tap FINISH.<br><br>" +
            "Afterwards: re-pair your phone, PC and TV with new codes, and update the GitHub secrets HUB_PASS and NTFY_TOPIC (shown on the next screen).</div><div style='margin-top:1em'>" + secBtn("sec-go", "YES, MAKE NEW KEYS", true) + "</div>");
        bindTap($("sec-go"), function() {
            busyStart("NEW KEYS", 12000);
            sendPower("rotate=1", function() {
                setTimeout(function() { loadScript("cloud.js", function() { busyEnd && busyEnd(); relockOld(); showGitHubSteps(); }); }, 1500);
            });
        });
    }); });
    on("sec-steps", function() { secGate("Show the GitHub steps", showGitHubSteps); });
    on("sec-done", function() { secGate("Finish the key change", function() {
        var left = oldLockedLeft();
        if (left) { relockOld(); secBox("<div class='hv-lbl'>Not yet</div><div class='hv-hint'>" + left + " item(s) still use the old passphrase. They were just re-locked here and go to the cloud with the next lists sync. Sync, then tap FINISH again.</div>"); return; }
        sendPower("keysdone=1", function() { loadScript("cloud.js", function() { renderSecurityPane(); }); });
    }); });
}
function showGitHubSteps() {
    var C = window.HUB_CLOUD || {};
    secBox("<div class='hv-lbl'>Finish on GitHub</div><div class='hv-hint' style='font-size:1em;line-height:1.5'>" +
        "On github.com: your Kitchen Hub repo &rsaquo; Settings &rsaquo; Secrets and variables &rsaquo; Actions. Update these (type them exactly, dashes included):<br>" +
        "<b>HUB_PASS</b> = <span style='font-family:Courier,monospace;font-weight:900;font-size:1.15em'>" + esc(C.pass || "") + "</span><br>" +
        (C.pass0 ? "<b>HUB_PASS_OLD</b> (new secret, for the switch) = <span style='font-family:Courier,monospace;font-weight:900'>" + esc(C.pass0) + "</span><br>" : "") +
        "<b>NTFY_TOPIC</b> = <span style='font-family:Courier,monospace;font-weight:900'>" + esc(C.ntfy || "") + "</span><br><br>" +
        "In the ntfy app on your phone, subscribe to the new NTFY_TOPIC (and unsubscribe the old one).<br>" +
        "Then re-pair: Settings &rsaquo; Security &rsaquo; Pair a device (phone, PC with <b>kh pair</b>, TV).<br>" +
        "When everything works, tap FINISH, and delete HUB_PASS_OLD on GitHub.</div>", true);
}

// ===================== 6. THE PHONE TAB AND THE SHOPPING QR: no secrets in QR codes any more =====================
pairLink = function() { return ""; };            // the old open pairing link (token + passphrase in the QR) is gone
tvLink = function() { return ""; };              // the TV code is on the Security tab, sealed
var __phonePane109 = renderPhonePane;
renderPhonePane = function() {
    __phonePane109();
    var C = window.HUB_CLOUD || {}, qr = $("ph-qr"), hint = $("ph-qrhint");
    if (!qr || !hint) return;
    qr.innerHTML = "";
    hint.innerHTML = (C.gist && C.token) ? "Pairing codes are on the <b>Security</b> tab now (they need your authenticator code). The list QR on the Shopping tile only opens the app."
                                         : "Not set up yet. Lists still work on the fridge. To use them from your phone, add cloud.conf (GITHUB_SETUP.txt).";
};
var __openShopQR109 = openShopQR;
openShopQR = function() {
    var C = window.HUB_CLOUD || {}, pg = pagesUrl(C.pages);
    if (!pg || !C.gist) return __openShopQR109();      // no phone app: a snapshot of the list, as before
    try { $("sv-qrin").innerHTML = qrSvg(pg + "#list"); } catch (e) {}
    $("sv-qrcap").innerHTML = "Scan with a phone that's already paired: it opens the live list. (New phone? Settings &rsaquo; Security &rsaquo; Pair a device.)";
    $("sv-qrbox").style.display = "block";
};

// ===================== 7. A NEW GITHUB TOKEN FROM THE PHONE =====================
var GHT_SENT = "";
function pickUpToken() {
    if (!secOn()) return;
    var cf = itemsOf("cfg"), i;
    for (i = 0; i < cf.length; i++) {
        var it = cf[i];
        if (it.id !== "ghtoken" || it.locked || !/^[A-Za-z0-9_]{20,255}$/.test(it.text) || GHT_SENT === it.text) continue;
        GHT_SENT = it.text;
        sendPower("ghtoken=" + it.text, function(r) {
            if (r !== "ok") { GHT_SENT = ""; return; }
            itemEdit("ghtoken", "cfg", "del", "");       // handed over: take it out of the gist
            loadScript("cloud.js", function() {});
        });
    }
}
// after every items reload: move old-locked items to the new key, pick up a new token
var __applyItems109 = applyItems;
applyItems = function() { __applyItems109(); try { relockOld(); pickUpToken(); } catch (e) {} };
