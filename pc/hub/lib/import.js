/* Kitchen Hub v11 - bring the old gist list over: locked items are unlocked to plain text (v11 has no passphrase).
 * An item that can't be unlocked (wrong passphrase) is skipped, never stored locked. */
"use strict";
const HubData = require("../../../cloud/hubdata.js"), { HubCrypt } = HubData;
function importLines(text, pass) {
    const out = [HubData.HEADER]; let total = 0, unlocked = 0, stillLocked = 0;
    String(text).split("\n").forEach(l => {
        const it = HubData.parseLine(l.replace(/\r$/, "")); if (!it) return;
        total++;
        let t = it.text;
        if (HubCrypt.isLocked(t)) {
            const u = pass ? HubCrypt.unlock(t, pass) : null;
            if (u === null) { stillLocked++; return; }
            t = u; unlocked++;
        }
        out.push(HubData.makeLine(it.ts, it.id, it.kind, it.state, t));
    });
    return { text: out.join("\n") + "\n", total, unlocked, stillLocked };
}
module.exports = { importLines };
