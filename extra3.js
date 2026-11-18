// Kitchen Hub phone app 10.3: BOOKS - your book cloud. Upload books you own (EPUB, PDF, MOBI, AZW3, TXT);
// mark which ones belong on the Kindle (they download into its library at the next sync); download any of them
// back to this phone; add free classics from Project Gutenberg.
(function() {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function brainX() { try { var x = JSON.parse(ls.get("kh_extras") || "null"); return (x && x.brain) || {}; } catch (e) { return {}; } }
  function rawBase() { var b = brainX(); if (!b.booksGist || !b.owner) return ""; return (/api\.github\.com/.test(cfg.api) ? "https://gist.githubusercontent.com" : cfg.api) + "/" + b.owner + "/" + b.booksGist + "/raw/"; }      // (a test server stands in for GitHub)
  function put(kind, text, id, state) { store = lockEdit(store, id || HubData.newId("p"), kind, state || "open", text); ls.set(K.store, store); render(); syncSoon(400); }
  function books() { return itemsOf("book").filter(function(i) { return i.state === "open" && !i.locked; }).map(function(i) { var o = HubCal.parseRec("book", i.text); o.id = i.id; return o; }); }
  function size(n) { n = +n || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function today() { return todayK(); }
  var EXTS = ["epub", "pdf", "mobi", "azw3", "azw", "txt", "prc"], MAX = 30 * 1048576, PART = 2000000;
  var UP = { busy: false, msg: "" }, GUT = { q: "", res: null, msg: "" }, HAVE = null;
  function kindleHas() { try { var k = JSON.parse(ls.get("kh_extras") || "null"); return (k && k.kindle && k.kindle.books) || null; } catch (e) { return null; } }

  function render2() {
    var box = $("app-k"); if (!box) return;
    var bs = books().sort(function(a, c) { return (c.added || "") < (a.added || "") ? -1 : 1; }), b = brainX(), h = "";
    h += "<h2>Your book cloud</h2>";
    if (!b.booksGist) h += '<p class="empty">The book cloud is made by the cloud brain on its next run (10.3). Open this tab again in a few minutes.</p>';
    h += '<div class="card"><label class="fl">Upload a book you own (EPUB, PDF, MOBI, AZW3, TXT; up to 30 MB)<input type="file" id="bk-f" accept=".epub,.pdf,.mobi,.azw3,.azw,.txt,.prc"' + (UP.busy || !b.booksGist ? " disabled" : "") + '></label>' +
         '<label style="font-size:15px"><input type="checkbox" id="bk-k" checked> Put it on the Kindle</label>' +
         (UP.msg ? '<p class="sub" id="bk-msg">' + esc(UP.msg) + "</p>" : "") +
         '<p class="sub">EPUBs are turned into Kindle format by the cloud (a few minutes). Books with DRM (most store-bought Kindle books) can\'t be used.</p></div>';
    h += '<ul class="xl">';
    if (!bs.length) h += '<li class="empty">No books yet.</li>';
    bs.forEach(function(x) {
      h += "<li><div><b>" + esc(x.title || "Untitled") + "</b>" + (x.author ? " · " + esc(x.author) : "") + '<div class="sub">' + esc(String(x.ext).toUpperCase()) + " · " + size(x.size) + " · " +
        (x.want === "kindle" ? ((kindleHas() || []).indexOf(x.id) >= 0 ? "✓ on the Kindle" : "goes to the Kindle at its next sync") : "cloud only") + (x.conv === "epub" ? " · converted from EPUB" : x.conv === "fail" ? " · EPUB (couldn't convert; KOReader reads it)" : x.ext === "epub" && x.want === "kindle" ? " · converting…" : "") + "</div>" +
        '<div class="row">' + (x.want === "kindle" ? bt("want", x.id + "|cloud", "Cloud only") : bt("want", x.id + "|kindle", "Put on Kindle")) + bt("dl", x.id, "Download") + bt("del", x.id, "Delete") + "</div></div></li>";
    });
    h += "</ul>";
    h += '<h2>Send an article to the Kindle</h2><div class="row"><input id="ar-u" inputmode="url" placeholder="https://… a long read, a recipe" style="flex:1"><button class="btn" data-b="article">Send</button></div>' +
         '<p class="sub">The cloud turns the page into a Kindle book (text only) and it lands in the library with your books.</p>';
    var arts = itemsOf("req").filter(function(r) { return /^book\|url\|/.test(r.text || ""); }).slice(-3);
    arts.forEach(function(r) { var f = r.text.split("|"); h += '<p class="sub">' + esc(f.slice(2, f.length > 4 ? -2 : undefined).join("|").slice(0, 60)) + " - " + (r.state === "open" ? "waiting for the cloud" : /\|ok\|/.test(r.text) ? "✓ on your shelf" : "didn't work: " + esc(f[f.length - 1])) + "</p>"; });
    h += '<h2>Free classics (Project Gutenberg)</h2><div class="row"><input id="gt-q" placeholder="Austen, Sherlock Holmes, Jack London…" value="' + esc(GUT.q) + '" style="flex:1"><button class="btn" data-b="gsearch">Search</button></div>';
    if (GUT.msg) h += '<p class="sub">' + esc(GUT.msg) + "</p>";
    if (GUT.res) {
      var asked = {}; itemsOf("req").forEach(function(r) { var m = /^book\|gut\|(\d+)/.exec(r.text || ""); if (m) asked[m[1]] = r.state === "open" ? "Asked" : /\|ok\|/.test(r.text) ? "Added" : "Failed: " + (r.text.split("|")[4] || ""); });
      h += '<ul class="xl">' + (GUT.res.length ? "" : '<li class="empty">Nothing found.</li>');
      GUT.res.forEach(function(r) { h += "<li><div><b>" + esc(r.title) + "</b> · " + esc(r.author) + '<div class="row">' + (asked[r.id] ? '<span class="sub">' + esc(asked[r.id]) + "</span>" : bt("gadd", r.id + "|" + r.title, "+ Add to my cloud")) + "</div></div></li>"; });
      h += "</ul>";
    }
    box.innerHTML = h;
    [].forEach.call(box.querySelectorAll("[data-b]"), function(el) { el.addEventListener("click", function(e) { e.preventDefault(); ACT[el.getAttribute("data-b")](el.getAttribute("data-v") || "", el); }); });
    var f = $("bk-f"); if (f) f.addEventListener("change", function() { if (f.files && f.files[0]) upload(f.files[0], $("bk-k").checked); });
  }
  function bt(a, v, label) { return '<button class="btn ghost sm" data-b="' + a + '" data-v="' + esc(v) + '">' + label + "</button>"; }
  function say(t) { UP.msg = t; var m = $("bk-msg"); if (m) m.textContent = t; else render2(); }

  // ---------- upload: the list line first (so nothing tidies the parts away mid-upload), then the parts, then .meta ----------
  function upload(file, onKindle) {
    var ext = (/\.([a-z0-9]+)$/i.exec(file.name) || [])[1]; ext = ext ? ext.toLowerCase() : "";
    if (EXTS.indexOf(ext) < 0) return say("That kind of file can't go on a Kindle (EPUB, PDF, MOBI, AZW3, TXT).");
    if (file.size > MAX) return say("That book is over 30 MB.");
    var b = brainX(); if (!b.booksGist) return say("No book cloud yet - wait for the cloud brain's next run.");
    UP.busy = true; say("Reading " + file.name + "…");
    var rd = new FileReader();
    rd.onerror = function() { UP.busy = false; say("Couldn't read that file."); };
    rd.onload = function() {
      var buf = new Uint8Array(rd.result);
      crypto.subtle.digest("SHA-256", buf).then(function(d) {
        var sha = [].map.call(new Uint8Array(d), function(x) { return ("0" + x.toString(16)).slice(-2); }).join("");
        var bin = "", i; for (i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        var b64 = btoa(bin).replace(/(.{76})/g, "$1\n"), n = Math.max(1, Math.ceil(b64.length / PART)), id = HubData.newId("b").replace(/[^A-Za-z0-9]/g, "");
        var title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim(), author = "";
        var m = /^(.+?)\s+-\s+(.+)$/.exec(title); if (m) { title = m[1]; author = m[2]; }
        put("book", HubCal.recText("book", { title: title, author: author, ext: ext, size: buf.length, want: onKindle ? "kindle" : "cloud", src: "upload", added: today(), conv: "" }), id);
        var i2 = 0;
        (function next() {
          if (i2 < n) {
            say("Uploading " + title + "… " + Math.round(i2 / n * 100) + "%");
            var files = {}; files["bk_" + id + ".p" + i2] = { content: b64.slice(i2 * PART, (i2 + 1) * PART) };
            return gist(b.booksGist, files).then(function() { i2++; next(); }, fail);
          }
          var mf = {}; mf["bk_" + id + ".meta"] = { content: ext + " " + buf.length + " " + sha + " " + n + "\n" };
          gist(b.booksGist, mf).then(function() { UP.busy = false; say("✓ " + title + " is in your book cloud" + (onKindle ? " - on the Kindle after its next sync." : ".")); render2(); }, fail);
        })();
      }, function() { UP.busy = false; say("This browser can't check the file (needs HTTPS)."); });
    };
    rd.readAsArrayBuffer(file);
  }
  function fail(e) { UP.busy = false; say("Upload stopped: " + (e && e.message || "no connection") + ". Delete the book and try again."); render2(); }
  function gist(gid, files) {
    return timed(cfg.api + "/gists/" + gid, { method: "PATCH", headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ files: files }) }, 120000)
      .then(function(r) { if (!r.ok) throw new Error("GitHub said " + r.status); return r.json(); });
  }
  // ---------- download a book back to this phone ----------
  function download(id, el) {
    var base = rawBase(), x = books().filter(function(q) { return q.id === id; })[0]; if (!base || !x) return;
    el.textContent = "Downloading…";
    fetch(base + "bk_" + id + ".meta", { cache: "no-store" }).then(function(r) { return r.text(); }).then(function(t) {
      var m = t.trim().split(/\s+/), n = +m[3], parts = [], i = 0;
      if (!n) throw new Error("not uploaded completely");
      return (function next() {
        if (i >= n) return parts.join("");
        return fetch(base + "bk_" + id + ".p" + i, { cache: "no-store" }).then(function(r) { if (!r.ok) throw new Error("part " + i + " missing"); return r.text(); }).then(function(p) { parts.push(p); i++; return next(); });
      })().then(function(b64) {
        var bin = atob(b64.replace(/\s/g, "")), u8 = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
        var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([u8])); a.download = (x.title || "book") + "." + m[0];
        document.body.appendChild(a); a.click(); setTimeout(function() { a.remove(); }, 1000); el.textContent = "Downloaded";
      });
    }).catch(function(e) { el.textContent = "Failed: " + e.message; });
  }
  var ACT = {
    want: function(v) { var p = v.split("|"), x = books().filter(function(q) { return q.id === p[0]; })[0]; if (!x) return; x.want = p[1]; put("book", HubCal.recText("book", x), x.id); },
    del: function(id) { var it = itemsOf("book").filter(function(i) { return i.id === id; })[0]; if (it && confirm("Delete this book from your book cloud (and the Kindle)?")) put("book", it.text, id, "del"); },
    dl: function(id, el) { download(id, el); },
    gsearch: function() {
      var q = $("gt-q").value.trim(); if (!q) return;
      GUT.q = q; GUT.msg = "Searching…"; GUT.res = null; render2();
      fetch("https://gutendex.com/books/?search=" + encodeURIComponent(q)).then(function(r) { return r.json(); }).then(function(j) {
        GUT.msg = ""; GUT.res = (j.results || []).slice(0, 30).map(function(r) { var a = r.authors && r.authors[0] ? String(r.authors[0].name || "") : ""; return { id: String(r.id), title: String(r.title || ""), author: a.replace(/^([^,]+), (.+)$/, "$2 $1") }; }); render2();
      }, function() { GUT.msg = "Project Gutenberg's search didn't answer. Try again in a bit."; render2(); });
    },
    article: function() { var u = $("ar-u").value.trim(); if (!/^https?:\/\/\S+$/i.test(u)) { if (/^\S+\.\S+$/.test(u)) u = "https://" + u; else return; } put("req", "book|url|" + u); },
    gadd: function(v) { var p = v.split("|"); put("req", "book|gut|" + p[0] + "|" + (p.slice(1).join(" ") || "").replace(/\|/g, "/").slice(0, 80)); }
  };
  window.renderBooks = render2;
})();
