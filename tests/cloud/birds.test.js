// 10.9: bird of the hour (cloud/birds.js) with fake Wikipedia / Commons answers. Run: node tests/cloud/birds.test.js
const path = require("path"), birds = require(path.join(__dirname, "../../cloud/birds.js"));
let fails = 0; function check(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
let calls = 0;
function fakeGet(u) {
    calls++;
    if (u.indexOf("/page/summary/") > 0) {
        const t = decodeURIComponent(u.split("/page/summary/")[1]);
        if (/raven/i.test(t)) return Promise.resolve(null);                                    // lookup failed
        return Promise.resolve(JSON.stringify({ thumbnail: { source: "https://upload.wikimedia.org/thumb/" + t + "_320px.jpg" }, originalimage: { source: "https://upload.wikimedia.org/x/" + t + ".jpg" } }));
    }
    if (u.indexOf("commons.wikimedia.org/w/api.php") > 0) {
        const nonfree = /Bald_eagle/.test(decodeURIComponent(u));
        return Promise.resolve(JSON.stringify({ query: { pages: { "1": { imageinfo: [{ extmetadata: { LicenseShortName: { value: nonfree ? "Fair use" : "CC BY-SA 4.0" }, Artist: { value: "<a href='x'>Jane Doe</a>" } } }] } } } }));
    }
    return Promise.resolve(null);
}
(async () => {
    const st = {}, logs = [];
    const ctx = { get: fakeGet, NOW: Date.UTC(2026, 10, 19, 20), TODAY: "2026-11-19", log: s => logs.push(s), state: st };
    const a = await birds(ctx);
    check(calls <= 12, "at most 6 birds looked up per run (" + calls + " requests)");
    check(a.length >= 1 && a.every(b => /^img\/b[0-9a-f]{12}\.jpg$/.test(b.img) && /^https:\/\/upload\.wikimedia\.org\//.test(b.src)), "photos: Wikimedia thumbnails with safe local names");
    check(a.every(b => b.by === "Jane Doe" && b.lic === "CC BY-SA 4.0"), "credit and licence kept (HTML stripped)");
    check(!a.some(b => b.n === "Bald Eagle") && st.birds["Bald eagle"] === undefined || (st.birds["Bald eagle"] && st.birds["Bald eagle"].none), "a photo that isn't freely licensed is never used");
    const summer = birds.BIRDS.filter(b => b[2] === "s").map(b => b[0]);
    check(!a.some(b => summer.indexOf(b.n) >= 0), "November: no summer-only birds");
    // later runs: more get looked up; then everything comes from the cache
    for (let i = 0; i < 4; i++) await birds(ctx);
    calls = 0; const b2 = await birds(ctx);
    check(calls === 0 && b2.length === 12, "after a few runs: 12 birds, no requests (cache)");
    const b3 = await birds({ ...ctx, TODAY: "2026-11-20" });
    check(JSON.stringify(b3.map(b => b.n)) !== JSON.stringify(b2.map(b => b.n)), "a different set tomorrow");
    const jul = await birds({ ...ctx, TODAY: "2026-07-01", NOW: Date.UTC(2026, 6, 1) });
    check(jul.length > 0 && !jul.some(b => ["Bohemian Waxwing", "Snow Bunting", "Common Redpoll", "Northern Shrike"].indexOf(b.n) >= 0), "July: no winter-only birds");
    process.exit(fails ? 1 : 0);
})();
