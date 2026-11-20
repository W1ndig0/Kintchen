// 10.9: runs the real cloud brain (cloud/brain.js) against a fake GitHub on this machine.
// Checks: one full run works offline, it re-locks plain lines, and during a key change (HUB_PASS_OLD) it reads
// and moves old-locked items to the new passphrase, and a GitHub that never answers can't hang it.
// Run: node tests/cloud/brain.test.js
const http = require("http"), path = require("path"), cp = require("child_process");
const HubData = require(path.join(__dirname, "../../cloud/hubdata.js")), HubCrypt = HubData.HubCrypt;
let fails = 0; function check(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

function fakeGitHub(gists, opts) {
    let n = 0;
    const srv = http.createServer((req, res) => {
        let body = ""; req.on("data", d => body += d); req.on("end", () => {
            if (opts && opts.hang) return;                     // never answers
            const m = /^\/gists\/?([A-Za-z0-9]*)$/.exec(req.url.split("?")[0]);
            res.setHeader("Content-Type", "application/json");
            if (!m) { res.statusCode = 404; return res.end("{}"); }
            if (req.method === "POST") { const id = "g" + (++n); gists[id] = { id, files: JSON.parse(body).files }; return res.end(JSON.stringify(gists[id])); }
            const g = gists[m[1]]; if (!g) { res.statusCode = 404; return res.end("{}"); }
            if (req.method === "PATCH") { const f = JSON.parse(body).files || {}; for (const k in f) { if (f[k] === null) delete g.files[k]; else g.files[k] = f[k]; } }
            res.end(JSON.stringify({ id: g.id, files: Object.fromEntries(Object.entries(g.files).map(([k, v]) => [k, { filename: k, content: v.content, truncated: false }])) }));
        });
    });
    return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}
function runBrain(port, env, ms) {
    return new Promise(resolve => {
        const t0 = Date.now();
        const p = cp.spawn(process.execPath, [path.join(__dirname, "../../cloud/brain.js")], {
            env: { PATH: process.env.PATH, GIST_ID: "main", GIST_TOKEN: "github_pat_TEST", GH_API: "http://127.0.0.1:" + port, OFFLINE: "1", SKIP_BUNDLE: "1", BRAIN_NOW: String(Date.UTC(2026, 10, 19, 18)), ...env },
            stdio: ["ignore", "pipe", "pipe"]
        });
        let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
        const kill = setTimeout(() => p.kill("SIGKILL"), ms || 60000);
        p.on("exit", code => { clearTimeout(kill); resolve({ code, out, secs: (Date.now() - t0) / 1000 }); });
    });
}
(async () => {
    const OLD = "old-words-here", NEW = "ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2";
    let store = HubData.HEADER + "\n";
    store = HubData.edit(store, "a1", "shop", "open", HubCrypt.lock("milk", OLD), Date.UTC(2026, 10, 18));
    store = HubData.edit(store, "a2", "shop", "open", HubCrypt.lock("eggs", NEW), Date.UTC(2026, 10, 18));
    store = HubData.edit(store, "a3", "shop", "open", "bread (plain, from a Shortcut)", Date.UTC(2026, 10, 18));
    store = HubData.edit(store, "a4", "shop", "open", HubCrypt.lock("someone else's", "other"), Date.UTC(2026, 10, 18));
    const gists = { main: { id: "main", files: { "hub.tsv": { content: store } } } };
    const srv = await fakeGitHub(gists), port = srv.address().port;
    const r = await runBrain(port, { HUB_PASS: NEW, HUB_PASS_OLD: OLD });
    check(r.code === 0, "brain run finished (exit " + r.code + ", " + r.secs.toFixed(1) + " s)");
    const after = gists.main.files["hub.tsv"].content, its = {};
    HubData.items(after).forEach(it => its[it.id] = it.text);
    check(HubCrypt.unlock(its.a1, NEW) === "milk", "item locked with the OLD passphrase moved to the new one");
    check(HubCrypt.unlock(its.a2, NEW) === "eggs", "item already on the new passphrase unchanged");
    check(HubCrypt.isLocked(its.a3) && HubCrypt.unlock(its.a3, NEW) === "bread (plain, from a Shortcut)", "plain line locked with the new passphrase");
    check(HubCrypt.unlock(its.a4, NEW) === null && HubCrypt.unlock(its.a4, "other") === "someone else's", "item with an unknown passphrase left alone");
    check(/moved 1 to the new passphrase/.test(r.out), "log says how many moved (counts only)");
    check(!/milk|eggs|bread|github_pat_TEST/.test(r.out), "public log shows no item text and no token");
    const cloudId = Object.keys(gists).find(k => k !== "main" && gists[k].files["tv.json"]);
    const tv = cloudId && gists[cloudId].files["tv.json"] && JSON.parse(gists[cloudId].files["tv.json"].content);
    check(tv && tv.locked && HubCrypt.unlock(tv.locked, NEW) !== null && HubCrypt.unlock(tv.locked, OLD) === null, "TV data locked with the new passphrase only");
    // without HUB_PASS_OLD nothing old is touched (and nothing breaks)
    store = HubData.edit(gists.main.files["hub.tsv"].content, "b1", "shop", "open", HubCrypt.lock("cheese", OLD), Date.UTC(2026, 10, 19));
    gists.main.files["hub.tsv"].content = store;
    const r2 = await runBrain(port, { HUB_PASS: NEW });
    const b1 = HubData.items(gists.main.files["hub.tsv"].content).filter(it => it.id === "b1")[0];
    check(r2.code === 0 && HubCrypt.unlock(b1.text, OLD) === "cheese", "no HUB_PASS_OLD: old-locked item left as it was");
    srv.close();
    // a GitHub that never answers: the run ends with an error instead of hanging until the 8-minute limit
    const hang = await fakeGitHub({}, { hang: true });
    const r3 = await runBrain(hang.address().port, { HUB_PASS: NEW }, 120000);
    check(r3.code !== 0 && r3.code !== null && r3.secs < 70 && /timed out/.test(r3.out), "GitHub never answers: brain stops with 'timed out' in " + r3.secs.toFixed(0) + " s");
    hang.close();
    process.exit(fails ? 1 : 0);
})();
