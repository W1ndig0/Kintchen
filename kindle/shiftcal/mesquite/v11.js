/* Kitchen Hub 11.0 - the fridge works with the hub on your PC. Nothing on this page talks about GitHub any more.
 *  1. Settings > PC (was Phone): which PC, the lists, the calendar code, alerts.
 *  2. Settings > Updates: updates come from the PC (check / install / go back / what's new, auto-update), send log.
 *  3. Settings > Security: the authenticator; pairing and keys happen on the PC (control panel > Devices).
 *  4. Books: your PC's book folder (no cloud, no Project Gutenberg tab).
 * Loaded after v1010.js; ES5 only (the Kindle's old browser). */
(function() {
    function C() { return window.HUB_CLOUD || {}; }
    function pcAddr() { return (C().pc || "").replace(/^https?:\/\//, ""); }

    // ---------- 1. Settings > PC ----------
    var tabs = $("hv-tabs").getElementsByTagName("div");
    for (var i = 0; i < tabs.length; i++) if (tabs[i].getAttribute("data-tab") === "phone") tabs[i].innerHTML = "PC";

    renderPhonePane = function() {
        var c = C(), qr = $("ph-qr"), hint = $("ph-qrhint"), st = $("ph-status");
        if (!qr || !hint || !st) return;
        qr.innerHTML = "";
        hint.innerHTML = c.pc ? "Paired with your PC at <b>" + esc(pcAddr()) + "</b>. Phones and computers pair in the PC's control panel (Devices &rsaquo; Pair a device)."
                              : "Not paired with your PC yet. On the PC: control panel &rsaquo; Devices &rsaquo; Pair the fridge, and put the 3 lines it shows in cloud.conf. Lists still work on the fridge alone.";
        var shopN = itemsOf("shop").length, rcN = itemsOf("recipe").length;
        var line1 = (CLOUD_ST === "never" || !CLOUD_ST) ? "No sync with the PC yet." : (CLOUD_ST.indexOf("ok") === 0 ? "Last sync with the PC: ok." : esc(CLOUD_ST) + ".");
        st.innerHTML = line1 + "<br>" + shopN + " shopping item" + (shopN === 1 ? "" : "s") + " &middot; " + rcN + " recipe" + (rcN === 1 ? "" : "s") +
            (c.cdataAt ? "<br>Weather and news from the PC: " + ago(c.cdataAt) : "") +
            (CLOUD_PEND ? "<br><b>Changes made here are waiting for the next sync.</b>" : "");
        chipRow("opt-cloudwake", [1, 0], ["On", "Off"], c.wake === 0 ? 0 : 1, function(v) {
            sendPower("cloudwake=" + v, function(r) { if (r !== "ok") $("ph-status").innerHTML += "<br>Loop not reachable - try again."; });
        });
        var codes = $("ph-codes");
        if (codes) {
            var ics = c.ics ? c.ics.replace(/^https?:/, "webcal:") : "";
            codes.innerHTML = ics ? "<div class='gh-q'><div class='gh-qr'>" + qrSvg(ics) + "</div><div class='hv-hint'><b>Calendar</b><br>Scan with the iPhone camera: shifts, events, chores and holidays in your phone's calendar (it refreshes when the phone can reach the PC).</div></div>"
                                  : "<div class='hv-hint'>The calendar code appears after the PC's first sync with the fridge.</div>";
        }
        gitHubPane();
    };
    phoneAlertsPane = function() {
        var box = $("ph-ntfy"); if (!box) return;
        box.innerHTML = "<div class='hv-hint'>" + (C().pc ? "Timer and battery alerts go to your phone through the PC: in the Kitchen Hub app on the phone, Status &rsaquo; Turn on alerts."
                                                          : "Alerts work once the fridge is paired with your PC.") + "</div>";
    };

    // ---------- 2. Settings > Updates ----------
    gitHubPane = function() {
        var box = $("ph-gh"), c = C(), S = window.HUB_STATE || {};
        if (!box) return;
        if (!c.pc) { box.innerHTML = "<div class='hv-hint'>Updates come from your PC once the fridge is paired with it.</div>"; return; }
        box.innerHTML = "<div class='hv-hint'>Updates come from your PC (" + esc(pcAddr()) + "). The PC signs the list of files and the fridge checks every one.</div>" +
            "<div style='margin:.3em 0'><span class='opt-btn' id='gh-upd'>CHECK FOR UPDATE</span> <span class='opt-btn' id='gh-log'>SEND LOG TO THE PC</span></div>" +
            "<div class='hv-hint' id='gh-msg'>" + updText() + "</div>" +
            "<div style='margin:.4em 0'><span class='hv-lbl' style='margin-right:.5em'>Updates</span><span id='opt-autoupd'></span></div>" +
            "<div class='hv-hint'>&ldquo;At night&rdquo; installs a new version from your PC after 2 am. If a new version doesn't start properly it is undone by itself, and that version is skipped.</div>" +
            "<div style='margin:.3em 0'><span class='opt-btn' id='gh-rb'>GO BACK TO THE PREVIOUS VERSION</span> <span class='opt-btn' id='gh-new'>WHAT'S NEW</span></div>";
        chipRow("opt-autoupd", [0, 1, 2], ["Only when I tap", "Tell me", "At night"], S.autoUpd === undefined ? 1 : +S.autoUpd, function(v) { S.autoUpd = v; sendPower("autoupd=" + v); });
        bindTap($("gh-upd"), function() {
            var install = UPD && UPD.state === "available";
            sendPower("job=update-" + (install ? "install" : "check"));
            $("gh-msg").innerHTML = install ? "Downloading the update from your PC&hellip; the hub restarts by itself when it's done." : "Asking your PC&hellip;";
            pollUpdate(0);
        });
        bindTap($("gh-log"), function() { sendPower("job=logup"); $("gh-msg").innerHTML = "Sending the log to your PC (control panel &rsaquo; the data folder &rsaquo; logs)."; });
        bindTap($("gh-rb"), function() {
            var el = $("gh-rb");
            if (!el.__sure) { el.__sure = 1; el.innerHTML = "SURE? TAP AGAIN TO GO BACK"; return; }
            sendPower("job=update-rollback"); $("gh-msg").innerHTML = "Going back to the previous version&hellip; the hub restarts by itself.";
        });
        bindTap($("gh-new"), function() { closeHub(); openXV("news102", 0); });
        if (typeof HVS !== "undefined") HVS.sig = "";
    };
    var __updText11 = updText;
    updText = function() { return UPD ? __updText11() : "Updates come from your PC."; };

    // ---------- 3. Settings > Security ----------
    renderSecurityPane = function() {
        var p = $("pane-security"), c = C(), h = "";
        if (!p) return;
        h += "<div class='sec-row'><div class='hv-lbl'>Authenticator</div><span class='sec-st'>" + (secOn() ? "On" : "Not set up") + "</span>" +
             "<div class='hv-hint'>A 6-digit code from Google or Microsoft Authenticator on your phone guards hub mode and other big changes on this fridge.</div>" +
             (secOn() ? "" : "<div>" + secBtn("sec-setup", "SET UP", true) + "</div>") + "</div>";
        h += "<div class='sec-row'><div class='hv-lbl'>Your PC</div><span class='sec-st'>" + (c.pc ? "Paired (" + esc(pcAddr()) + ")" : "Not paired") + "</span>" +
             "<div class='hv-hint'>The fridge signs everything it sends the PC with its own key. To pair again or remove it: the PC's control panel &rsaquo; Devices. " +
             "Phones and computers pair there too.</div></div>";
        p.innerHTML = h;
        var e = $("sec-setup"); if (e) bindTap(e, function() { secSetup(function() { renderSecurityPane(); }); });
    };
    showPairing = function() { secBox("<div class='hv-lbl'>Pairing moved to your PC</div><div class='hv-hint'>Open the Kitchen Hub control panel on the PC &rsaquo; Devices &rsaquo; Pair a device.</div>", true); };
    showGitHubSteps = function() {};
    if (typeof pickUpToken === "function") pickUpToken = function() {};

    // ---------- 3b. items still locked with the old passphrase: written back plain (the PC has no passphrase) ----------
    // (the page still opens them with pass0; this makes them readable on the PC and the phone too)
    var __relock11 = relockOld;
    relockOld = function() {
        var c = C();
        if (!c.pc) return __relock11();
        if (!c.pass0 || c.pass) return 0;
        var its = HubData.items(STORE), n = 0, out = [], i, t;
        for (i = 0; i < its.length && n < 200; i++) {
            if (!HubCrypt.isLocked(its[i].text)) continue;
            t = HubCrypt.unlockNew ? HubCrypt.unlockNew(its[i].text, c.pass0) : HubCrypt.unlock(its[i].text, c.pass0);
            if (t === null) continue;
            out.push(storeEdit(its[i].id, its[i].kind, its[i].state, t)); n++;
        }
        if (n) { storeSave(); queueLines(out); }
        return n;
    };

    // ---------- 4. Books: the PC's book folder ----------
    if (window.XV_TABS) XV_TABS.books = ["MY BOOKS"];
    if (window.XVR && XVR.books) {
        var __books11 = XVR.books;
        XVR.books = function() {
            var h = __books11(0);
            h = h.replace(/ in your cloud/g, " in your PC's book folder").replace(/<span class='opt-btn[^']*' data-a='book(Want|Del)'[^>]*>[^<]*<\/span>/g, "")
                 .replace(/<b class='tag o'>IN THE CLOUD<\/b>/g, "<b class='tag o'>ON THE PC</b>");
            if (!recs("book").length) h = "<div class='sv-empty'>No books yet. Put books (EPUB, PDF, MOBI, AZW3, TXT) in the <b>Kitchen Hub Books</b> folder on your PC: they arrive in the Kindle's library at the next sync, and leave it when you take them out of the folder.</div>";
            else h = h.replace(/(<div class='hv-hint'>[^<]*?)Add your own boo[^<]*/, "$1 Add or remove books in the Kitchen Hub Books folder on your PC.");
            return h;
        };
    }
    khMark && khMark("v11: the hub on the PC");
})();
