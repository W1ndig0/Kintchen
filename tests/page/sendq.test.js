// 10.9: the Kindle page sends item edits one batch at a time, retries dropped batches, and resends lines the Kindle file is missing.
const fs = require("fs"), path = require("path");
const HubData = require(path.join(__dirname, "../../cloud/hubdata.js"));
const src = fs.readFileSync(path.join(__dirname, "../../kindle/shiftcal/mesquite/index.html"), "utf8");
const a = src.indexOf("var SEND_Q = [], sendTimer = 0;"), b = src.indexOf("function lineOf(id)");
let timers = [], now = 0;
global.setTimeout = (f, ms) => { timers.push({ t: now + ms, f }); return timers.length; };
global.clearTimeout = () => {};
function run(until) { for (;;) { timers.sort((x, y) => x.t - y.t); if (!timers.length || timers[0].t > until) { now = until; return; } const x = timers.shift(); now = x.t; x.f(); } }
let delivered = [], dropNext = 0, logs = [];
global.diagOnce = m => logs.push(m);
global.sendPower = (q, done) => { const lines = decodeURIComponent(q.slice(5)).split("\n"); setTimeout(() => { if (dropNext > 0) { dropNext--; done("unreachable"); } else { delivered.push(...lines); done("ok"); } }, 9000 * (dropNext > 0) + 100); };
global.HubData = HubData;
eval(src.slice(a, b).replace("var SEND_Q", "global.SEND_Q").replace(/var (SEND_BUSY|RESENT)/g, "global.$1"));
eval("global.STORE = HubData.HEADER + '\\n'");
let fails = 0; function check(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
// 1: 3 batches, all delivered, in order, one at a time
const big = []; for (let i = 0; i < 60; i++) big.push(HubData.makeLine(1000 + i, "id" + i, "shop", "open", "x".repeat(100)));
queueLines(big); run(60000);
check(delivered.length === 60 && delivered.every((l, i) => l === big[i]), "3 batches delivered in order");
// 2: first two attempts dropped -> retried, nothing lost
delivered = []; dropNext = 2; queueLines([HubData.makeLine(5000, "a1", "shop", "open", "milk")]); run(200000);
check(delivered.length === 1 && delivered[0].includes("milk"), "dropped batch retried and delivered");
// 3: resendMissing: page has an edit the file lacks -> resent; file newer -> not resent
delivered = []; dropNext = 0;
STORE = HubData.merge([HubData.HEADER, HubData.makeLine(7000, "b1", "shop", "open", "eggs"), HubData.makeLine(7000, "b2", "shop", "open", "bread")], 8000);
resendMissing([HubData.makeLine(9000, "b2", "shop", "done", "bread")]); run(300000);
check(delivered.length === 1 && delivered[0].includes("eggs"), "line missing from the Kindle file resent; newer file version kept");
// 4: refused line retried at most 3 times
delivered = [];
for (let k = 0; k < 6; k++) { resendMissing([]); run(now + 20000); }
check(delivered.filter(l => l.includes("eggs")).length === 2 && RESENT["7000\tb1\tshop\topen\teggs"] === 3, "a line is resent at most 3 times per page start");
process.exit(fails ? 1 : 0);
