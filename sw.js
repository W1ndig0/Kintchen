// Keeps the app itself available with no signal (the list lives in localStorage). GitHub API calls are never cached.
var C = "kh-v12", FILES = ["./", "index.html", "hubdata.js", "extra.js", "extra2.js", "extra3.js", "manifest.json", "tv.html"];
self.addEventListener("install", function(e) { e.waitUntil(caches.open(C).then(function(c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener("activate", function(e) {
  e.waitUntil(caches.keys().then(function(ks) { return Promise.all(ks.filter(function(k) { return k !== C; }).map(function(k) { return caches.delete(k); })); })
    .then(function() { return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e) {
  var u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  // network first so updates arrive; but on a weak signal fall back to the saved copy after 3 s
  // 10.1.2: only a page load of the app itself falls back to index.html (the TV page offline used to open the phone app)
  var isApp = e.request.mode === "navigate" && /\/(index\.html)?$/.test(u.pathname);
  var fromCache = function() { return caches.match(e.request, { ignoreSearch: true }).then(function(r) { return r || (isApp ? caches.match("index.html") : null); }); };
  var net = fetch(e.request).then(function(r) {
    if (r.ok) { var copy = r.clone(); caches.open(C).then(function(c) { c.put(e.request, copy); }); }
    return r;
  });
  e.respondWith(new Promise(function(done) {
    var settled = false, finish = function(r) { if (!settled && r) { settled = true; done(r); } };
    var t = setTimeout(function() { fromCache().then(function(r) { if (r) finish(r); }); }, 3000);
    net.then(function(r) { clearTimeout(t); finish(r); }, function() { clearTimeout(t); fromCache().then(function(r) { finish(r || Response.error()); }); });
  }));
});
