/* Kitchen Hub v11 service worker: alerts from the PC, and the app's offline copy (the list itself is kept by the app). */
var CACHE = "kh11-v1", SHELL = ["./", "index.html", "app.js", "app.css", "hubdata.js", "qr.js", "manifest.webmanifest"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener("activate", function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener("fetch", function (e) {
    var u = new URL(e.request.url);
    if (e.request.method !== "GET" || u.origin !== location.origin || /^\/(api|kindle|cal)\//.test(u.pathname)) return;
    // network first (always the newest app when the PC answers), the saved copy when it doesn't
    e.respondWith(fetch(e.request).then(function (r) { var c = r.clone(); caches.open(CACHE).then(function (ca) { ca.put(e.request, c); }); return r; })
        .catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match("index.html"); }); }));
});
self.addEventListener("push", function (e) {
    var d = {}; try { d = e.data.json(); } catch (x) { d = { title: "Kitchen Hub", body: e.data ? e.data.text() : "" }; }
    e.waitUntil(self.registration.showNotification(d.title || "Kitchen Hub", { body: d.body || "", tag: "kh-" + Date.now() }));
});
self.addEventListener("notificationclick", function (e) {
    e.notification.close();
    e.waitUntil(self.clients.matchAll({ type: "window" }).then(function (cs) { return cs.length ? cs[0].focus() : self.clients.openWindow("./"); }));
});
