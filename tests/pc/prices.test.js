// Kitchen Hub v11: price check (matching, sizes, picks, missing items, ranking, price book CSV).   node tests/pc/prices.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { Prices, match, sizeOf, unitPrice, parseFlipp } = require(ROOT + "/pc/hub/lib/prices.js");
let pass = 0, fail = 0;
async function t(n, f) { try { await f(); pass++; console.log("PASS " + n); } catch (e) { fail++; console.log("FAIL " + n + ": " + (e && e.stack || e)); } }

// shaped like Flipp's answer (keys seen live 2026-11-21: items[].merchant_name/name/current_price, ecom_items[].merchant/...)
const FLIPP = {
    milk: { items: [{ merchant_name: "Real Canadian Superstore", name: "Neilson 2% Milk 4 L", current_price: 6.25, sale_story: "", valid_to: "2026-11-26" },
                    { merchant_name: "Save-On-Foods", name: "Dairyland Milk 4 L", current_price: 6.99 },
                    { merchant_name: "Costco", name: "Kirkland Milk", current_price: null, sale_story: "Buy 2 save" },
                    { merchant_name: "Shoppers Drug Mart", name: "Milk 4 L", current_price: 5.0 }],
            ecom_items: [{ merchant: "Walmart", name: "Great Value 2% Partly Skimmed Milk 4 L", current_price: 6.47 },
                         { merchant: "Walmart", name: "Milk 2 Go Chocolate 310 Ml", current_price: 1.48 }] },
    "cheddar cheese": { items: [{ merchant_name: "Save-On-Foods", name: "Western Family Cheddar Cheese 700 g", current_price: 8.99 }],
                        ecom_items: [{ merchant: "Walmart", name: "Great Value Medium Cheddar Cheese 700 g", current_price: 9.47 }] },
    bananas: { items: [], ecom_items: [{ merchant: "Walmart", name: "Banana, Sold in singles, 0.11 - 0.25 kg", current_price: 0.3 }] }
};
const get = async (u) => { const q = decodeURIComponent(/&q=([^&]*)/.exec(u)[1]); return FLIPP[q] ? JSON.stringify(FLIPP[q]) : '{"items":[],"ecom_items":[]}'; };

(async () => {
    await t("names match by their words (plurals, store-brand words ignored)", () => {
        assert.ok(match("Milk", "Great Value 2% Partly Skimmed Milk 4 L") === 1);
        assert.ok(match("cheddar cheese", "Western Family Cheddar Cheese 700 g") === 1);
        assert.ok(match("bananas", "Banana, Sold in singles") === 1);
        assert.ok(match("milk", "Dog biscuits") === 0);
    });
    await t("sizes and unit prices", () => {
        assert.deepStrictEqual(sizeOf("Milk 4 L"), { amount: 4000, unit: "ml" });
        assert.deepStrictEqual(sizeOf("Pop 12 x 355 mL"), { amount: 4260, unit: "ml" });
        assert.deepStrictEqual(sizeOf("Chicken 1.5kg"), { amount: 1500, unit: "g" });
        assert.deepStrictEqual(sizeOf("Eggs 12 count"), { amount: 12, unit: "each" });
        assert.strictEqual(unitPrice(6, "Milk 4 L").per, "100 mL"); assert.strictEqual(unitPrice(6, "Milk 4 L").value, 0.15);
        assert.strictEqual(sizeOf("Bread"), null);
    });
    await t("Flipp answer: only the four stores, only real prices", () => {
        const c = parseFlipp(JSON.stringify(FLIPP.milk));
        assert.deepStrictEqual(c.map(x => x.store).sort(), ["saveon", "superstore", "walmart", "walmart"]);
        assert.ok(!c.some(x => x.price === null || x.store === "costco"));
        assert.deepStrictEqual(parseFlipp("not json"), []);
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khpr-"));
    const P = new Prices({ dataDir: dir, get });
    P.addBook({ store: "costco", item: "Milk", product: "Kirkland 2% Milk 4 L", price: 5.89 });
    let r;
    await t("whole list: totals, missing items, cheapest single store, savings", async () => {
        r = await P.check([{ name: "Milk", qty: 2 }, { name: "Cheddar cheese", qty: 1 }, { name: "Bananas", qty: 1 }]);
        const by = Object.fromEntries(r.totals.map(x => [x.store, x]));
        assert.strictEqual(by.walmart.total, 22.71); assert.deepStrictEqual(by.walmart.missing, []);
        assert.deepStrictEqual(by.saveon.missing, ["Bananas"]); assert.strictEqual(by.saveon.total, 22.97);
        assert.deepStrictEqual(by.costco.missing, ["Cheddar cheese", "Bananas"]); assert.strictEqual(by.costco.total, 11.78);
        assert.strictEqual(r.best, "Walmart", "the only store with everything wins");
        assert.strictEqual(r.totals[0].more, 0);
        assert.strictEqual(by.saveon.more, 0.56, "Save-On vs Walmart on milk x2 + cheese: 22.97 - 22.41"); assert.strictEqual(by.saveon.common, 2);
        assert.strictEqual(by.costco.more, -1.16, "Costco milk x2 vs Walmart milk x2"); assert.strictEqual(by.costco.common, 1);
        assert.ok(/^Cheapest: Walmart \$22\.71/.test(r.summary), r.summary);
        assert.ok(r.items[0].stores.walmart.pick.name.indexOf("Partly Skimmed Milk 4 L") > 0, "the 4 L milk, not the 310 mL chocolate one");
    });
    await t("a pick you change is used next time; 'not sold here' counts as missing; forget goes back", async () => {
        P.pick("Milk", "walmart", { name: "Milk 2 Go Chocolate 310 Ml", price: 1.48 });
        r = await P.check([{ name: "Milk", qty: 1 }]);
        assert.strictEqual(r.items[0].stores.walmart.pick.price, 1.48); assert.ok(r.items[0].stores.walmart.picked);
        P.pick("milk", "saveon", { none: 1 });
        r = await P.check([{ name: "Milk", qty: 1 }]);
        assert.ok(!r.items[0].stores.saveon.pick); assert.deepStrictEqual(r.totals.find(x => x.store === "saveon").missing, ["Milk"]);
        P.pick("Milk", "walmart", null);
        r = await P.check([{ name: "Milk", qty: 1 }]); assert.strictEqual(r.items[0].stores.walmart.pick.price, 6.47);
        assert.ok(new Prices({ dataDir: dir, get }).db.picks["milk|saveon"].none, "picks saved on disk");
    });
    await t("Flipp down: the price book still prices Costco, everything else missing (never $0)", async () => {
        const Q = new Prices({ dataDir: dir, get: async () => null });
        r = await Q.check([{ name: "Milk", qty: 1 }]);
        assert.strictEqual(r.best, "Costco"); assert.strictEqual(r.totals[0].total, 5.89);
        assert.ok(r.totals.slice(1).every(x => x.missing.length === 1 && x.total === 0));
    });
    await t("price book: bad entries refused, CSV out and back in", () => {
        assert.strictEqual(P.addBook({ store: "nope", item: "x", price: 1 }), null);
        assert.strictEqual(P.addBook({ store: "costco", item: "x", price: -1 }), null);
        const csv = P.exportCsv(); assert.ok(/^store,item,product,price,added\ncostco,"Milk","Kirkland 2% Milk 4 L",5\.89,/.test(csv), csv);
        const Q = new Prices({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "khpr2-")), get });
        assert.strictEqual(Q.importCsv(csv + 'Save-On-Foods,"Eggs, large","Eggs ""Grade A"" 12",4.49,2026-11-01\n'), 2);
        assert.strictEqual(Q.db.book[1].item, "Eggs, large"); assert.strictEqual(Q.db.book[1].product, 'Eggs "Grade A" 12'); assert.strictEqual(Q.db.book[1].store, "saveon");
    });
    console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})();
