// Kitchen Hub v11: the jobs (cloud/brain.js) run on the PC against the local store.   node tests/pc/jobs.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const HubData = require(ROOT + "/cloud/hubdata.js"), { HubCrypt } = HubData;
const { Store } = require(ROOT + "/pc/hub/lib/store.js");
const { BrainHost } = require(ROOT + "/pc/hub/lib/brainhost.js");
let pass = 0, fail = 0;
async function t(n, f) { try { await f(); pass++; console.log("PASS " + n); } catch (e) { fail++; console.log("FAIL " + n + ": " + (e && e.stack || e)); } }
(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khjobs-")), store = new Store(dir);
    const NOW = Date.UTC(2026, 10, 21, 15, 0);    // 7 am Prince George: morning briefing time
    store.merge([HubData.makeLine(NOW - 1000, "a1", "shop", "open", "Milk"), HubData.makeLine(NOW - 900, "c1", "chore", "open", "daily|07:00|Feed the cat")]);
    const alerts = [];
    const jobs = new BrainHost({ store, dataDir: dir, onAlert: a => alerts.push(a), env: { OFFLINE: "1", SKIP_BUNDLE: "1", BRAIN_NOW: String(NOW) } });
    await jobs.start();
    let r;
    await t("a full run of the jobs works on the PC", async () => { r = await jobs.run("test"); assert.strictEqual(r.code, 0, r.out); });
    await t("the list stays plain text (no passphrase in v11)", () => {
        const its = store.items(); assert.ok(its.length >= 2); assert.ok(!its.some(i => HubCrypt.isLocked(i.text)), "nothing locked");
    });
    await t("brain.json and the calendar land in the data folder", () => {
        assert.ok(fs.existsSync(path.join(dir, "gist/main/brain.json")));
        assert.ok(/BEGIN:VCALENDAR/.test(fs.readFileSync(path.join(dir, "gist/cloud/calendar.ics"), "utf8")));
    });
    await t("alerts are captured instead of going to ntfy", () => {
        assert.ok(alerts.length >= 1, "got " + alerts.length + " alerts; output: " + r.out.slice(-600));
        assert.ok(jobs.alerts().length === alerts.length);
    });
    await t("only one run at a time", async () => { const a = jobs.run("x"), b = jobs.run("y"); assert.strictEqual(a, b); await a; });
    await t("gist emulator refuses odd file names", () => {
        jobs.writeFiles("cloud", { "../evil.txt": { content: "x" }, "ok.txt": { content: "y" } });
        assert.ok(!fs.existsSync(path.join(dir, "gist/evil.txt"))); assert.ok(fs.existsSync(path.join(dir, "gist/cloud/ok.txt")));
    });
    jobs.stop();
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
