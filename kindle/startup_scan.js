// 10.9.3 build check: code that runs while the page starts must not read a variable that is only set further
// down. That is exactly what broke 10.9-10.9.2 on the Kindle (applyItems > resendMissing > diagOnce read
// DIAG_SENT ~1900 lines before it was set: TypeError, the page never started, rollback).
// Follows each top-level statement into the functions it calls (the version of each function that exists at
// that point). Hits that already existed in 10.8 and are guarded at run time are listed in KNOWN; anything new
// fails the build. Usage: node startup_scan.js page_script.js v109.js
const acorn = require("acorn"), walk = require("acorn-walk"), fs = require("fs");
const KNOWN = new Set((process.env.KH_SCAN_KNOWN || "").split(/\s+/).filter(Boolean));
const files = process.argv.slice(2), progs = files.map(f => [f, acorn.parse(fs.readFileSync(f, "utf8"), { ecmaVersion: 5, locations: true })]);
const defs = {}, varInit = {}, stmts = [];
const addDef = (n, pos, node) => (defs[n] = defs[n] || []).push([pos, node]);
progs.forEach(([f, p], fi) => p.body.forEach(st => {
  const pos = fi * 1e6 + st.loc.start.line;
  if (st.type === "FunctionDeclaration") { addDef(st.id.name, -1 - pos / 1e7, st); return; }       // hoisted; later declaration wins
  if (st.type === "VariableDeclaration") st.declarations.forEach(d => { if (d.init && !(d.id.name in varInit)) varInit[d.id.name] = pos; if (d.init && d.init.type === "FunctionExpression") addDef(d.id.name, pos, d.init); });
  if (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression" && st.expression.left.type === "Identifier" && st.expression.right.type === "FunctionExpression") addDef(st.expression.left.name, pos, st.expression.right);
  stmts.push([pos, st, f]);
}));
function defAt(name, pos) { let best = null; (defs[name] || []).forEach(([p, n]) => { if (p < pos && (!best || p > best[0])) best = [p, n]; }); return best && best[1]; }
// what runs NOW inside node: identifiers read and direct calls; nested function bodies are not entered,
// except functions passed straight to forEach/map/filter/some/every/sort (they run now)
function now(node) {
  const ids = new Set(), calls = new Set();
  walk.recursive(node, null, {
    Function(n, s, c) { if (n === node) c(n.body, s); },
    Identifier(n) { ids.add(n.name); },
    CallExpression(n, s, c) {
      if (n.callee.type === "Identifier") calls.add(n.callee.name);
      c(n.callee, s);
      const it = n.callee.type === "MemberExpression" && /^(forEach|map|filter|some|every|sort|reduce)$/.test(n.callee.property.name || "");
      n.arguments.forEach(a => { if (it && /Function/.test(a.type)) c(a.body, s); else c(a, s); });
    }
  });
  return { ids, calls };
}
const out = new Map();
stmts.forEach(([pos, st, f]) => {
  if (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression" && st.expression.right.type === "FunctionExpression") return;
  const seen = new Set(), path = {};
  const visit = (node, via) => { const r = now(node);
    r.ids.forEach(id => { if (id in varInit && varInit[id] > pos) { const k = `${f.split("/").pop()}:${st.loc.start.line} -> ${id} (set at ${varInit[id] >= 1e6 ? "v109.js:" + (varInit[id] - 1e6) : "line " + varInit[id]})`; if (!out.has(k)) out.set(k, via); } });
    r.calls.forEach(c => { if (seen.has(c)) return; seen.add(c); const d = defAt(c, pos); if (d) visit(d.body, via + " > " + c); }); };
  visit(st, "");
});
let bad = 0;
[...out].forEach(([k, v]) => { const name = k.split(" -> ")[1].split(" ")[0]; if (KNOWN.has(name)) return; bad++; console.log("READ BEFORE SET: " + k + "   via" + v); });
process.exit(bad ? 1 : 0);
