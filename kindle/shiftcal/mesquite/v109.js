khNow("v109.js: started");     // 10.9.2 black box
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

// ===================== 8. POWER: quick timer wakes, the standby clock, the frontlight =====================
// The loop says in state.js whether the next timer wake is a quick one (quick:1) and how the standby clock
// works (clockMode "15" | "min"). On a quick wake (or a minute tick) the page stays on its standby view and
// refreshes quietly: no black flash, no switch to the tiles and back.
var PWR = { quick: 0, clockMode: "15", light: -1, quickWake: 1, rate7: 0, wakesPerDay: 0 };
var __applyState109 = applyState;
applyState = function(s) {
    if (s) {
        PWR.quick = parseInt(s.quick, 10) === 1 ? 1 : 0;
        if (s.clockMode) PWR.clockMode = s.clockMode === "min" ? "min" : "15";
        if (s.frontlight !== undefined) { PWR.light = parseInt(s.frontlight, 10); if (isNaN(PWR.light)) PWR.light = -1; }      // -1 = the Kindle's own
        if (s.quickWake !== undefined) PWR.quickWake = parseInt(s.quickWake, 10) === 0 ? 0 : 1;
        PWR.rate7 = parseFloat(s.rate7) || 0; PWR.wakesPerDay = parseFloat(s.wakesPerDay) || 0;
    }
    __applyState109(s);
    if (HUB.sleeping) frontClock();
};
var __onWake109 = onWake;
onWake = function() {
    // the clock jumped (back from suspend) but the loop still says standby: a quick wake or a minute tick
    if (HUB.sleeping && (PWR.quick || PWR.clockMode === "min")) { quietRefresh(); return; }
    __onWake109();
};
var QUIET_LAST = 0;
function quietRefresh() {
    frontClock();
    var t = new Date().getTime();
    if (t - QUIET_LAST < 50000) return;          // minute ticks: only the clock; data at most once a minute
    QUIET_LAST = t;
    pollState(); reloadDataScript(); reloadItemsScript();
}
// the standby page's clock: exact minutes, and honest about how long it will stay on screen
function frontClock() {
    var cw = $("fp-cw"); if (!cw || $("front").style.display !== "block") return;
    var n = getBCNow(), h12 = n.getUTCHours() % 12 || 12, mm = n.getUTCMinutes(), ap = n.getUTCHours() >= 12 ? "PM" : "AM";
    var key = h12 + ":" + mm + PWR.clockMode + HUB.next;
    if (cw.__k === key) return;
    cw.__k = key;
    cw.innerHTML = h12 + "<span class='fp-dash'>:" + (mm < 10 ? "0" : "") + mm + "</span><span class='fp-ap'>" + ap + "</span>";
    var k = $("front").getElementsByClassName("fp-k")[0];
    if (k) {
        var night = (window.HUB_STATE || {}).where === "night";
        k.innerHTML = PWR.clockMode === "min" ? "Asleep &middot; clock keeps time" :
            (night ? "Night &middot; back at " + esc(HUB.next || "morning") : "Asleep &middot; until " + esc(HUB.next || "the next wake"));
    }
}
var __renderFront109 = renderFront;
renderFront = function() { __renderFront109(); var cw = $("fp-cw"); if (cw) cw.__k = ""; frontClock(); };
var __updateClock109 = updateClock;
updateClock = function(force) { __updateClock109(force); if (HUB.sleeping) frontClock(); };

// Settings > Sleep: three new rows, each saved at once
var __buildSmart109 = buildSmartOpts;
buildSmartOpts = function() {
    __buildSmart109();
    var box = $("v9-power");
    if (!box) {
        box = document.createElement("div"); box.id = "v9-power";
        var after = $("smart-rows"); if (!after || !after.parentNode) return;
        after.parentNode.insertBefore(box, after.nextSibling);
    }
    var use = PWR.rate7 > 0 ? "Lately about <b>" + PWR.rate7 + "%</b> of the battery an hour" + (PWR.wakesPerDay ? " (" + Math.round(PWR.wakesPerDay) + " wakes a day)" : "") + ". Change one thing, then compare after a day or two."
                            : "The battery use per hour shows here after a few hours on battery.";
    box.innerHTML =
        "<div class='hv-row'><div class='hv-lbl'>Timer wakes</div><div id='opt-quick'></div><div class='hv-hint'>Quick: the Kindle refreshes the standby page in a few seconds and sleeps again; the power button (or a tap while it refreshes) opens the hub. Full: every wake keeps the hub open for the wake window.</div></div>" +
        "<div class='hv-row'><div class='hv-lbl'>Standby clock</div><div id='opt-clockm'></div><div class='hv-hint'>Every minute: a short wake each minute to change the time (no Wi-Fi, no touch). Every wake: the time is exact at each wake and shows when it changes next.</div></div>" +
        "<div class='hv-row'><div class='hv-lbl'>Light while you use it</div><div id='opt-light'></div><div class='hv-hint'>Kindle's own: the hub doesn't touch the light. A level: that light while the hub is awake, off while it sleeps.</div></div>" +
        "<div class='hv-hint' id='v9-use'>" + use + "</div>";
    chipRow("opt-quick", [1, 0], ["Quick", "Full"], PWR.quickWake, function(v) { PWR.quickWake = v; sendPower("quickwake=" + v); });
    chipRow("opt-clockm", ["15", "min"], ["Every wake", "Every minute"], PWR.clockMode, function(v) { PWR.clockMode = v; sendPower("clockmode=" + v); });
    chipRow("opt-light", [-1, 0, 4, 8, 12, 16, 20, 24], ["Kindle's own", "Off", "4", "8", "12", "16", "20", "24"], PWR.light, function(v) { PWR.light = v; sendPower("light=" + (v < 0 ? "keep" : v)); });
    if (typeof HVS !== "undefined") HVS.sig = "";
};

// ===================== 9. TASK MANAGER: Settings > System (was "Log") =====================
// CPU, memory, the busiest processes and the Kindle's own services, from hub_sys.sh (it only looks).
// The service list is also in the cloud log: hub mode will stop only services proven safe on this Kindle.
(function() {
    var tabs = $("hv-tabs").getElementsByTagName("div");
    for (var i = 0; i < tabs.length; i++) if (tabs[i].getAttribute("data-tab") === "log") tabs[i].innerHTML = "System";
    var pane = $("pane-log"), box = document.createElement("div");
    box.id = "v9-sys"; box.style.marginBottom = ".6em";
    pane.insertBefore(box, pane.firstChild);
    var css = document.createElement("style");
    css.innerHTML = ".tm-big { font-weight: 900; font-size: 1.6em; font-family: Georgia, serif; } .tm-cell { display: table-cell; padding-right: 1.4em; vertical-align: top; }" +
        ".tm-bar { height: .45em; border: 2px solid #000; margin-top: .2em; width: 8em; } .tm-bar i { display: block; height: 100%; background: #000; }" +
        ".tm-t { width: 100%; border-collapse: collapse; font-size: .8em; } .tm-t td { border-bottom: 1px solid #000; padding: .12em .4em .12em 0; }" +
        ".tm-svc span { display: inline-block; border: 2px solid #000; padding: 0 .3em; margin: .12em .2em .12em 0; font-size: .75em; font-weight: bold; } .tm-svc span.off { border-style: dashed; font-weight: normal; }";
    document.getElementsByTagName("head")[0].appendChild(css);
})();
function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " GB" : n >= 1024 ? Math.round(n / 1024) + " MB" : n + " kB"; }
function upTxt(s) { var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? d + " d " + h + " h" : h ? h + " h " + m + " min" : m + " min"; }
function bar(p) { p = Math.max(0, Math.min(100, p)); return "<div class='tm-bar'><i style='width:" + p + "%'></i></div>"; }
function renderTaskManager() {
    var box = $("v9-sys"), S = window.HUB_SYS, h = "";
    if (!box) return;
    h += "<div class='hv-row'><span class='hv-lbl'>Task manager</span> <span class='opt-btn' id='tm-ref'>REFRESH</span>" +
         (S ? " <span class='hv-hint'>as of " + new Date(S.at * 1000).toTimeString().substring(0, 5) + "</span>" : "") + "</div>";
    if (!S) { box.innerHTML = h + "<div class='hv-hint'>Measuring&hellip; (a second or two)</div>"; bindTap($("tm-ref"), tmRefresh); return; }
    var used = S.memTotal - S.memAvail, mp = S.memTotal ? Math.round(used * 100 / S.memTotal) : 0;
    var dp = S.disk && S.disk[0] ? Math.round((S.disk[0] - S.disk[1]) * 100 / S.disk[0]) : 0;
    h += "<div style='display:table'>" +
        "<div class='tm-cell'><div class='hv-lbl'>CPU</div><div class='tm-big'>" + S.cpu + "%</div>" + bar(S.cpu) + "<div class='hv-hint'>load " + esc(S.load) + "</div></div>" +
        "<div class='tm-cell'><div class='hv-lbl'>Memory</div><div class='tm-big'>" + mp + "%</div>" + bar(mp) + "<div class='hv-hint'>" + kb(used) + " of " + kb(S.memTotal) + "</div></div>" +
        "<div class='tm-cell'><div class='hv-lbl'>Storage</div><div class='tm-big'>" + dp + "%</div>" + bar(dp) + "<div class='hv-hint'>" + kb(S.disk ? S.disk[1] : 0) + " free</div></div>" +
        "<div class='tm-cell'><div class='hv-lbl'>Battery</div><div class='tm-big'>" + (HUB.bat ? esc(HUB.bat) + "%" : "?") + "</div><div class='hv-hint'>" + (PWR.rate7 ? PWR.rate7 + "%/h lately" : "") + "<br>up " + upTxt(S.uptime) + "</div></div></div>";
    h += "<div class='hv-lbl' style='margin-top:.5em'>Busiest and biggest</div><table class='tm-t'><tr><td><b>Program</b></td><td><b>CPU</b></td><td><b>Memory</b></td></tr>";
    for (var i = 0; i < S.top.length && i < 8; i++) { var p = S.top[i]; h += "<tr><td>" + esc(p[1]) + "</td><td>" + p[3] + "%</td><td>" + kb(p[2]) + "</td></tr>"; }
    h += "</table>";
    if (S.svc && S.svc.length) {
        var on = 0; for (i = 0; i < S.svc.length; i++) if (S.svc[i][1]) on++;
        h += "<div class='hv-lbl' style='margin-top:.5em'>Kindle services &middot; " + on + " running of " + S.svc.length + "</div><div class='tm-svc'>";
        for (i = 0; i < S.svc.length; i++) h += "<span class='" + (S.svc[i][1] ? "" : "off") + "'>" + esc(S.svc[i][0]) + "</span>";
        h += "</div><div class='hv-hint'>Solid = running, dashed = stopped. Hub mode (coming next) will pause the ones the hub doesn't need; this list goes to your cloud log with SEND LOG so they can be checked first.</div>";
    }
    box.innerHTML = h;
    bindTap($("tm-ref"), tmRefresh);
    if (typeof HVS !== "undefined") HVS.sig = "";
}
function tmRefresh() {
    sendPower("sysinfo=1", null);
    setTimeout(function() { loadScript("sys.js", function() { if (HUB_OPEN && curTab === "log") renderTaskManager(); }); }, 3000);
}
var __selectTab109b = selectTab;
selectTab = function(name) {
    __selectTab109b(name);
    if (name === "log") { loadScript("sys.js", function() { if (HUB_OPEN && curTab === "log") renderTaskManager(); }); renderTaskManager(); tmRefresh(); }
};

// ===================== 10. SMARTER LAYOUT: space where it's needed, filler cards, live boosts =====================
//  * spare grid cells go first to tiles whose content didn't fit (measured after drawing, at most every 10 min)
//  * an empty shopping list and an idle timer shrink to the smallest size
//  * leftover cells show small filler cards (tomorrow's shift, sunset, the next holiday or event) instead of
//    stretching a random tile
//  * live boosts: a running timer, rain or a storm in the next 3 hours, a shift within 2 hours make that tile
//    a size bigger (up to two tiles, kept at least 30 minutes so the screen doesn't jump every wake)
// Settings > Look: "Smart space" and "Filler cards" (both on). Nothing changes while you edit the layout.
var SPACE = { need: {}, measuredAt: 0, relaidAt: 0, boost: [], boostUntil: 0, boostSig: "" };
// 10.9.1: only once the page has heard from the loop (start-up does the plain layout, as in 10.8)
function spaceOn() { return FEEL.space !== 0 && !EDIT && !PEEKED && !!HUB.seen; }
function fillersOn() { return FEEL.fillers !== 0 && spaceOn(); }
function tileEmpty(id) {
    if (id === "shop") { var a = itemsOf("shop"); for (var i = 0; i < a.length; i++) if (a[i].state === "open") return false; return true; }
    if (id === "timer") return !(TIMER.end > new Date().getTime()) && !TIMER.done;
    return false;
}
function rainSoon() {
    if (!WX || !WX.hourly || !WX.hourly.time) return false;
    var i0 = wxNowIndex(), h = WX.hourly, p = h.precipitation_probability || [], c = h.weather_code || [];
    if (i0 < 0) return false;
    for (var i = i0; i < i0 + 3 && i < h.time.length; i++) if ((p[i] || 0) >= 60 || (c[i] || 0) >= 95) return true;
    return false;
}
function shiftSoon() {
    try {
        var up = upcomingShifts(1);
        if (!up.length || up[0].i !== 0) return false;
        var ps = parseShift(up[0].v); if (!ps) return false;
        var n = getBCNow(), mins = n.getUTCHours() * 60 + n.getUTCMinutes(), d = ps.start - mins;
        return d >= 0 && d <= 120;
    } catch (e) { return false; }
}
function boostSignals() {
    var ids = [], now = new Date().getTime();
    if (TIMER.end > now || TIMER.done) ids.push("timer");
    if (rainSoon()) ids.push("wx");
    if (shiftSoon()) ids.push("shifts");
    return ids;
}
var __eff109 = effectiveList;
effectiveList = function(list, cols, rows, ok) {
    var keep = FEEL.dyn, l, i, j;
    FEEL.dyn = 0;
    try { l = __eff109(list, cols, rows, ok); } finally { FEEL.dyn = keep; }
    if (EDIT || PEEKED) return l;
    if (spaceOn()) for (i = 0; i < l.length; i++) if (!l[i].hid && SIZE_KEYS.indexOf(l[i].sz) > 0 && tileEmpty(l[i].id)) l[i] = { id: l[i].id, sz: "S", hid: 0 };
    if (!FEEL.dyn) return l;
    var now = new Date().getTime(), want = [], seen = {}, cand = (SPACE.boostUntil > now ? SPACE.boost : []).concat(boostSignals(), dayPart()[3]);
    for (i = 0; i < cand.length; i++) if (!seen[cand[i]]) { seen[cand[i]] = 1; want.push(cand[i]); }
    var boosted = [];
    for (j = 0; j < want.length && boosted.length < 2; j++) {
        for (i = 0; i < l.length; i++) if (l[i].id === want[j] && !l[i].hid) break;
        if (i === l.length) continue;
        var s = SIZE_KEYS.indexOf(l[i].sz);
        if (s < 0 || s >= 2) continue;                       // missing, or already big
        var base = packTiles(l, cols, rows, LAYOUT.fill !== 0, ok), trial = [];
        for (var k = 0; k < l.length; k++) trial.push({ id: l[k].id, sz: l[k].sz, hid: l[k].hid });
        trial[i].sz = SIZE_KEYS[s + 1];
        var t2 = packTiles(trial, cols, rows, LAYOUT.fill !== 0, ok), lost = false;
        for (k = 0; k < l.length; k++) if (!l[k].hid && base[l[k].id] && !base[l[k].id].nofit && t2[l[k].id] && t2[l[k].id].nofit) lost = true;
        if (!lost && t2[l[i].id] && t2[l[i].id].got === trial[i].sz) { l = trial; boosted.push(want[j]); }
    }
    var sig = boosted.join(",");
    if (sig !== SPACE.boostSig) { SPACE.boostSig = sig; SPACE.boost = boosted; SPACE.boostUntil = now + 30 * 60000; }
    return l;
};
// the packer: place every tile without stretching, then hand out the spare cells in this order:
// tiles that overflowed, then filler cards (up to 3), then everyone else as before (down, then right)
var __pack109 = packTiles;
packTiles = function(list, cols, rows, fill, ok) {
    if (!fill || !spaceOn()) return __pack109(list, cols, rows, fill, ok);
    var out = __pack109(list, cols, rows, false, ok), occ = [], r, c, i, id;
    for (r = 0; r < rows; r++) { occ[r] = []; for (c = 0; c < cols; c++) occ[r][c] = 0; }
    function free(c0, r0, w, h) {
        if (c0 + w > cols || r0 + h > rows) return false;
        for (var rr = r0; rr < r0 + h; rr++) for (var cc = c0; cc < c0 + w; cc++) if (occ[rr][cc]) return false;
        return true;
    }
    function mark(c0, r0, w, h, v) { for (var rr = r0; rr < r0 + h; rr++) for (var cc = c0; cc < c0 + w; cc++) occ[rr][cc] = v; }
    var placed = [];
    for (i = 0; i < list.length; i++) { id = list[i].id; var p = out[id]; if (p && !p.hidden && !p.nofit && p.w) { mark(p.c, p.r, p.w, p.h, id); placed.push(id); } }
    function grow(id) {
        var p = out[id];
        while (free(p.c, p.r + p.h, p.w, 1)) { mark(p.c, p.r + p.h, p.w, 1, id); p.h++; p.grew = 1; }
        while (free(p.c + p.w, p.r, 1, p.h)) { mark(p.c + p.w, p.r, 1, p.h, id); p.w++; p.grew = 1; }
    }
    for (i = 0; i < placed.length; i++) if (SPACE.need[placed[i]] === 2) grow(placed[i]);
    out.__fillers = [];
    if (fillersOn()) {
        var cards = fillerCards().length;
        for (r = 0; r < rows && out.__fillers.length < Math.min(cards, 3); r++) for (c = 0; c < cols && out.__fillers.length < Math.min(cards, 3); c++)
            if (!occ[r][c]) { occ[r][c] = "__filler"; out.__fillers.push({ c: c, r: r, w: 1, h: 1 }); }
    }
    for (i = 0; i < placed.length; i++) if (SPACE.need[placed[i]] !== 2 && !tileEmpty(placed[i])) grow(placed[i]);
    for (i = 0; i < placed.length; i++) grow(placed[i]);          // last resort: better a roomy empty tile than a blank hole
    for (i = 0; i < out.__fillers.length; i++) {                   // ...and filler cards stretch into what's left next to them
        var f = out.__fillers[i];
        while (free(f.c, f.r + f.h, f.w, 1)) { mark(f.c, f.r + f.h, f.w, 1, "__filler"); f.h++; }
        while (free(f.c + f.w, f.r, 1, f.h)) { mark(f.c + f.w, f.r, 1, f.h, "__filler"); f.w++; }
    }
    var empty = 0;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) if (!occ[r][c]) empty++;
    out.__empty = empty;
    return out;
};
// filler cards: small, only when there's something worth saying
var FILLER_EXTRA = [];            // other parts of 10.9 (the bird of the hour) add card makers here
var FILLER_MEMO = { at: 0, v: null };
function fillerCards() {           // 10.9.1: worked out at most once a minute (the packer asks many times per layout)
    var t = new Date().getTime();
    if (FILLER_MEMO.v && t - FILLER_MEMO.at < 60000) return FILLER_MEMO.v;
    FILLER_MEMO.v = fillerCardsNow(); FILLER_MEMO.at = t;
    return FILLER_MEMO.v;
}
function fillerCardsNow() {
    var out = [], i;
    try {
        var up = upcomingShifts(3);
        for (i = 0; i < up.length; i++) if (up[i].i === 1) { out.push(["TOMORROW", esc(shortShift(up[i].v))]); break; }
    } catch (e) {}
    var d = WX && WX.daily;
    if (d && d.sunset && d.sunrise) {
        var n = getBCNow(), mins = n.getUTCHours() * 60 + n.getUTCMinutes();
        out.push(mins < isoMin(d.sunset[0]) ? ["SUNSET", fmtClock(d.sunset[0])] : ["SUNRISE", fmtClock(d.sunrise[1] || d.sunrise[0])]);
    }
    try {
        var k = todayKey();
        for (i = 1; i <= 45; i++) { var hk = addDays(k, i), hol = HubCal.holiday(hk); if (hol) { out.push([i === 1 ? "TOMORROW" : "IN " + i + " DAYS", esc(hol)]); break; } }
    } catch (e) {}
    try {
        var ne = nextEvents(4);
        for (i = 0; i < ne.length; i++) if (ne[i].i >= 1) { out.push([ne[i].i === 1 ? "TOMORROW" : prettyDay(ne[i].d).split(",")[0].toUpperCase(), esc(ne[i].e.title)]); break; }
    } catch (e) {}
    for (i = FILLER_EXTRA.length - 1; i >= 0; i--) { try { var x = FILLER_EXTRA[i](); if (x) out.unshift(x); } catch (e) {} }      // (the bird first)
    return out;
}
var __placeTiles109 = placeTiles;
placeTiles = function() {
    __placeTiles109();
    var old = document.getElementsByClassName ? document.getElementsByClassName("v9-filler") : [], i;
    while (old.length) old[0].parentNode.removeChild(old[0]);
    var F = PLACED && PLACED.__fillers;
    if (!F || !F.length) return;
    var ok = orientKey(), g = GRID_DIMS[ok], cols = g[0], rows = g[1], GW = W - tagReserve().r, cards = fillerCards();
    for (i = 0; i < F.length && i < cards.length; i++) {
        var c = F[i].c, r = F[i].r, el = document.createElement("div");
        var x = Math.round(c * GW / cols), x2 = Math.round((c + F[i].w) * GW / cols), y = GRID_Y + Math.round(r * GRID_H / rows), y2 = GRID_Y + Math.round((r + F[i].h) * GRID_H / rows);
        el.className = "tile sz-" + shapeClass(F[i].w, F[i].h) + " v9-filler";
        el.style.borderRightWidth = (c + F[i].w < cols) ? "3px" : "0"; el.style.borderBottomWidth = (r + F[i].h < rows) ? "3px" : "0";
        el.innerHTML = "<div class='v9-fin'><div class='v9-fk'>" + cards[i][0] + "</div><div class='v9-fv'>" + cards[i][1] + "</div></div>";
        ($("t-clock") ? $("t-clock").parentNode : $("root")).appendChild(el);      // with the tiles (inside the stage, beside the rail)
        place(el, x, y, x2 - x, y2 - y);
        var im = el.getElementsByTagName("img")[0];
        if (im) { im.style.maxHeight = Math.round((y2 - y) * 0.42) + "px"; im.style.maxWidth = "100%"; }
        try { fitText(el.firstChild, 9, FS * 2.2); } catch (e) {}
    }
};
(function() {
    var css = document.createElement("style");
    css.innerHTML = ".v9-filler { display: block; overflow: hidden; } .v9-fin { position: absolute; left: 8%; right: 8%; top: 10%; bottom: 10%; display: table; width: 84%; height: 80%; }" +
        ".v9-fk { font-family: Helvetica, Arial, sans-serif; font-weight: 900; letter-spacing: .14em; font-size: .7em; margin-bottom: .3em; }" +
        ".v9-fv { font-family: Georgia, serif; font-weight: bold; line-height: 1.15; }";
    document.getElementsByTagName("head")[0].appendChild(css);
})();
// after drawing: which tiles didn't fit (they get spare cells at the next layout)
var __renderAll109 = renderAllTiles;
renderAllTiles = function() {
    __renderAll109();
    var now = new Date().getTime();
    if (!spaceOn() || HUB.sleeping || now - SPACE.measuredAt < 120000) return;
    SPACE.measuredAt = now;
    var changed = false;
    for (var i = 0; i < TILE_IDS.length; i++) {
        var id = TILE_IDS[i], p = PLACED[id];
        if (!p || p.hidden || p.nofit || !p.w) continue;
        var n = 0; try { n = overflowing($("t-" + id)) ? 2 : 0; } catch (e) {}
        if ((SPACE.need[id] || 0) !== n) { SPACE.need[id] = n; changed = true; }
    }
    if (changed && now - SPACE.relaidAt > 10 * 60000) { SPACE.relaidAt = now; setTimeout(relayout, 50); }
};
// Settings > Look
var __feel109 = buildFeelOpts;
buildFeelOpts = function() {
    __feel109();
    var pane = $("pane-feel"), box = $("v9-space");
    if (!pane) return;
    if (!box) { box = document.createElement("div"); box.id = "v9-space"; pane.appendChild(box); }
    box.innerHTML = "<div class='hv-row'><div class='hv-lbl'>Smart space</div><div id='opt-space'></div><div class='hv-hint'>Spare room goes to tiles whose content didn't fit; an empty shopping list or idle timer shrinks. Needs Fill gaps on (Tiles tab).</div></div>" +
        "<div class='hv-row'><div class='hv-lbl'>Filler cards</div><div id='opt-fillers'></div><div class='hv-hint'>Small cards in leftover space: tomorrow's shift, sunset, the next holiday or event.</div></div>";
    chipRow("opt-space", [1, 0], ["On", "Off"], FEEL.space === 0 ? 0 : 1, function(v) { FEEL.space = v; saveFeel(); SPACE.need = {}; relayout(); });
    chipRow("opt-fillers", [1, 0], ["On", "Off"], FEEL.fillers === 0 ? 0 : 1, function(v) { FEEL.fillers = v; saveFeel(); relayout(); });
};

// ===================== 11. THE KITCHEN MONITOR (mini PC + see-through screen) =====================
// The monitor shows tv.html. Each button here sends one command through your private ntfy channel
// (MON_TOPIC): locked with your passphrase, with the time and a counter, so nobody else can send one
// and an old one can't be replayed. Pair the monitor once: Settings > Security > TV / MONITOR.
var MON = { n: 0, stepN: 0, recipe: "" };
try { MON.n = parseInt(window.localStorage.getItem("pg_mon_n"), 10) || 0; } catch (e) {}
function monSend(c, a, note) {
    var C = window.HUB_CLOUD || {};
    if (!C.mon || !C.pass) { monMsg("The monitor isn't set up yet: Settings &rsaquo; Security &rsaquo; TV / MONITOR (it needs the cloud set up first)."); return; }
    MON.n++; try { window.localStorage.setItem("pg_mon_n", String(MON.n)); } catch (e) {}
    var msg = HubCrypt.lock(JSON.stringify({ c: c, a: a === undefined ? "" : a, t: new Date().getTime(), n: MON.n }), C.pass);
    sendPower("screen=" + msg, function(r) { monMsg(r === "ok" ? (note || "Sent") + " &mdash; the monitor shows it in a few seconds." : "The hub's loop didn't answer &mdash; try again."); });
    monMsg("Sending&hellip; (Wi-Fi turns on for a moment)");
}
function monMsg(h) { var m = $("mon-msg"); if (m) m.innerHTML = h; }
ICONS.screen = "<rect x='8' y='14' width='84' height='54' fill='none' stroke='%c' stroke-width='7'/><path d='M 36 86 L 64 86 M 50 68 L 50 86' stroke='%c' stroke-width='7'/>";
IC_LABEL.screen = "SCREEN";
var __appList109 = appList;
appList = function() {
    var L = __appList109(), C = window.HUB_CLOUD || {};
    L.splice(Math.max(0, L.length - 2), 0, ["screen", "Kitchen screen", C.mon ? "control the monitor" : "pair it in Security", openScreenPanel]);
    return L;
};
function openScreenPanel() {
    var rs = itemsOf("recipe"), h = "", i;
    function b(id, label, sel) { return "<span class='opt-btn big" + (sel ? " sel" : "") + "' id='" + id + "' style='margin:.15em .2em .15em 0'>" + label + "</span>"; }
    h += "<div class='hv-lbl'>Kitchen screen</div><div class='hv-hint' id='mon-msg'>Tap a button; the monitor follows in a few seconds.</div>";
    h += "<div class='hv-lbl' style='margin-top:.6em'>Show</div><div>" + b("ms-dash", "DASHBOARD") + b("ms-clock", "BIG CLOCK") + b("ms-timer", "MY TIMER") + b("ms-menu", "MENU BOARD") + b("ms-week", "THE WEEK") + b("ms-news", "NEWS") + b("ms-off", "SCREEN OFF") + "</div>";
    h += "<div class='hv-lbl' style='margin-top:.6em'>Screens</div><div>" + b("ms-prev", "&#9664; BACK") + b("ms-next", "NEXT &#9654;") + b("ms-pause", "PAUSE") + b("ms-play", "PLAY") + "</div>";
    if (rs.length) {
        h += "<div class='hv-lbl' style='margin-top:.6em'>Cook a recipe on the screen</div><div>";
        for (i = 0; i < rs.length && i < 8; i++) { var t = parseRecipe(rs[i].text).title; h += "<span class='opt-btn' data-rt='" + esc(t) + "' style='margin:.15em .2em .15em 0'>" + esc(t.substring(0, 28)) + "</span>"; }
        h += "</div><div>" + b("ms-sprev", "&#9664; STEP") + b("ms-snext", "STEP &#9654;") + b("ms-sdone", "DONE COOKING") + "</div>";
    }
    h += "<div class='hv-lbl' style='margin-top:.6em'>Look</div><div>" + b("ms-glass", "SEE-THROUGH") + b("ms-dark", "DARK") + b("ms-light", "LIGHT") + b("ms-auto", "AUTO") + "</div>";
    secBox(h, true);
    function on(id, f) { var e = $(id); if (e) bindTap(e, f); }
    on("ms-dash", function() { monSend("scene", "dash", "Dashboard"); });
    on("ms-clock", function() { monSend("scene", "clock", "Big clock"); });
    on("ms-timer", function() { if (!(TIMER.end > new Date().getTime())) { monMsg("No timer running here. Start one on the Timer tile first."); return; } monSend("timer", TIMER.end + "|" + (TIMER.mins || ""), "Timer"); });
    on("ms-menu", function() { monSend("scene", "menu", "Menu board"); });
    on("ms-week", function() { monSend("slide", "week", "The week"); });
    on("ms-news", function() { monSend("slide", "news", "News"); });
    on("ms-off", function() { monSend("scene", "off", "Screen off"); });
    on("ms-prev", function() { monSend("go", -1, "Back"); });
    on("ms-next", function() { monSend("go", 1, "Next"); });
    on("ms-pause", function() { monSend("pause", 1, "Paused"); });
    on("ms-play", function() { monSend("pause", 0, "Playing"); });
    on("ms-sprev", function() { monSend("step", -1, "Step back"); });
    on("ms-snext", function() { monSend("step", 1, "Next step"); });
    on("ms-sdone", function() { monSend("cook", "", "Done cooking"); });
    on("ms-glass", function() { monSend("theme", "glass", "See-through look"); });
    on("ms-dark", function() { monSend("theme", "dark", "Dark look"); });
    on("ms-light", function() { monSend("theme", "light", "Light look"); });
    on("ms-auto", function() { monSend("theme", "auto", "Auto look"); });
    var rb = $("sec-in").getElementsByTagName("span");
    for (i = 0; i < rb.length; i++) (function(el) { var t = el.getAttribute("data-rt"); if (t) bindTap(el, function() { monSend("cook", t, "Cooking " + t); }); })(rb[i]);
}

// ===================== 12. BIRD OF THE HOUR =====================
// 12 birds a day from around Prince George (the cloud picks them for the season), one per hour. Photos are
// freely licensed Wikimedia Commons pictures, downloaded with the sync into img/; the credit is shown.
var __cleanEX109 = cleanEX;
cleanEX = function(x) {
    x = __cleanEX109(x);
    if (!x) return x;
    var a = x.birds instanceof Array ? x.birds : [], out = [];
    for (var i = 0; i < a.length && out.length < 12; i++) {
        var b = a[i];
        if (!b || !b.n || !/^img\/b[0-9a-f]{12}\.(jpg|png)$/.test(String(b.img))) continue;
        out.push({ n: String(b.n).substring(0, 40), note: String(b.note || "").substring(0, 120), img: String(b.img), by: String(b.by || "").substring(0, 60), lic: String(b.lic || "").substring(0, 24) });
    }
    x.birds = out;
    return x;
};
function birdNow() { var B = EX && EX.birds; if (!B || !B.length) return null; return B[getBCNow().getUTCHours() % B.length]; }
FILLER_EXTRA.push(function() {
    var b = birdNow(); if (!b) return null;
    return ["BIRD OF THE HOUR", "<img src='" + esc(b.img) + "' alt='' onerror=\"this.style.display='none'\" style='display:block;margin:.1em 0 .2em;-webkit-filter:grayscale(1);filter:grayscale(1)'>" +
        esc(b.n) + "<div style='font:normal .45em Helvetica,Arial,sans-serif;margin-top:.2em'>" + esc(b.note) + "<br>Photo: " + esc(b.by) + " (" + esc(b.lic) + ")</div>"];
});
khNow("v109.js: finished");     // 10.9.2 black box
