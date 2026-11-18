/* Kitchen Hub 10.4 pantry automation (run by brain.js every ~15 min, so it works whichever device you use).
 *   1. Food you tick off the shopping list goes into the pantry (setting "fromList"):
 *      - already there (same name)            -> more of it, and the fresher date
 *      - a staple you'd used up (keep at least) -> brought back, keeping its "keep at least"
 *      - new                                   -> added with a guessed shelf life and place (HubPantry.guess)
 *   2. A staple that drops below "keep at least", or is used up/tossed, goes on the list once (setting "restock").
 * What has been handled is remembered in brain.json (brain.pantry), so nothing is added twice.          */
"use strict";

module.exports = function runPantry(ctx) {
    const { items, edit, newId, log, brain, TODAY, HubCal, HubPantry } = ctx;
    const cfgItem = items("cfg").find(x => x.id === "pantry" && x.text !== null);
    const C = HubPantry.cfg(cfgItem ? cfgItem.text : null);
    const st = brain.pantry = (brain.pantry && typeof brain.pantry === "object") ? brain.pantry : {};
    st.seen = st.seen || {}; st.listed = st.listed || {};

    const shop = items("shop").filter(s => s.text !== null);              // open + done (deleted ones are not returned)
    const pantry = items("pantry").filter(p => p.text !== null).map(p => Object.assign({ id: p.id, state: p.state, ts: p.ts }, HubCal.parseRec("pantry", p.text)));
    const save = (p, state) => { p.state = state || "open"; edit(p.id, "pantry", p.state, HubCal.recText("pantry", p)); };

    // first run after the update: whatever is already ticked off was bought before this existed
    if (!st.init) { shop.forEach(s => { if (s.state === "done") st.seen[s.id] = 1; }); st.init = TODAY; }

    // 1. ticked off the list -> into the pantry
    let added = 0;
    for (const s of shop) {
        if (s.state !== "done" || st.seen[s.id]) continue;
        st.seen[s.id] = 1;
        if (!C.on.fromList) continue;
        const sp = HubCal.parseShop(s.text);
        if (!sp.name || !HubPantry.isFood(sp.name)) continue;
        const g = HubPantry.guess(sp.name, C), fresh = HubCal.keyN(HubCal.dayNum(TODAY) + g.days);
        const same = pantry.filter(p => HubPantry.sameName(p.name, sp.name));
        const have = same.find(p => p.state === "open") || same.filter(p => p.state === "done" && p.low > 0).sort((a, b) => b.ts - a.ts)[0];
        if (have) {
            have.qty = (have.state === "open" ? (+have.qty || 0) : 0) + sp.qty;
            if (!have.expires || have.expires < fresh || have.state !== "open") have.expires = fresh;
            have.opened = "";
            save(have, "open");
        } else {
            const p = { id: newId(), state: "open", ts: 0, name: sp.name, expires: fresh, qty: sp.qty, where: g.where, opened: "", low: 0, unit: "" };
            save(p, "open"); pantry.push(p);
        }
        added++;
    }

    // 2. staples that ran low (or ran out) -> onto the list, once each time they run low
    let listed = 0;
    const onList = shop.filter(s => s.state === "open").map(s => HubCal.parseShop(s.text).name);
    for (const p of pantry) {
        const short = p.low > 0 && (p.state === "done" || HubPantry.needsRestock(p));
        if (!short) { delete st.listed[p.id]; continue; }
        if (st.listed[p.id] || !C.on.restock) continue;
        st.listed[p.id] = 1;
        const name = String(p.name).replace(/^leftovers?:\s*/i, "");
        if (onList.some(n => HubPantry.sameName(n, name))) continue;
        edit(newId(), "shop", "open", HubCal.shopText(name, "", 1, ""));
        onList.push(name); listed++;
    }

    // forget ids that are gone (cleared from the list, tidied out of the pantry)
    const shopIds = {}, pantryIds = {};
    shop.forEach(s => { shopIds[s.id] = 1; }); pantry.forEach(p => { pantryIds[p.id] = 1; });
    Object.keys(st.seen).forEach(k => { if (!shopIds[k]) delete st.seen[k]; });
    Object.keys(st.listed).forEach(k => { if (!pantryIds[k]) delete st.listed[k]; });

    if (added || listed) log("pantry: " + added + " from the list, " + listed + " put on the list");
    return { cfg: C };
};
