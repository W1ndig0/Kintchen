/* Kitchen Hub shared data (ES5: runs on the Kindle's old WebKit and on phones).
 *
 * The whole store is one text file of items, one per line, tab separated:
 *     ts <TAB> id <TAB> kind <TAB> state <TAB> text
 *   ts    milliseconds since 1970 when this version of the item was written
 *   id    [A-Za-z0-9._-]+, made once by the device that created the item
 *   kind  shop | sketch | recipe | note ...  ([a-z0-9:_-]+)
 *   state open | done | del
 *   text  item text with \\ \t \n escaped (sketch: stroke data, recipe: whole recipe)
 * An edit is a new line with the same id and a newer ts. Merging two copies = keep the newest line
 * per id, so any number of devices can edit offline and every copy ends up identical
 * (hub_merge.awk does exactly the same on the Kindle). Deleted items are kept 30 days so a
 * device that was offline does not bring them back.
 */
var HubData = (function() {
    var HEADER = "#hub v1", TOMB_MS = 30 * 864e5;
    var RE_TS = /^(0|[1-9][0-9]{0,14})$/, RE_ID = /^[A-Za-z0-9._-]{1,64}$/, RE_KIND = /^[a-z0-9:_-]{1,32}$/;
    var STATES = { open: 1, done: 1, del: 1 };

    // tabs/newlines escaped; other control characters and U+2028/9 (illegal in old JS strings) dropped
    function esc(s) { return String(s).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "").replace(/\n/g, "\\n").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ""); }
    function unesc(s) { return s.replace(/\\(.)/g, function(m, c) { return c === "t" ? "\t" : (c === "n" ? "\n" : c); }); }

    function parseLine(line) {
        var f = line.split("\t");
        if (f.length !== 5 || !RE_TS.test(f[0]) || !RE_ID.test(f[1]) || !RE_KIND.test(f[2]) || !STATES[f[3]] || /[\u0000-\u001f\u007f]/.test(f[4])) return null;
        return { ts: parseInt(f[0], 10), id: f[1], kind: f[2], state: f[3], text: unesc(f[4]), line: line };
    }
    function makeLine(ts, id, kind, state, text) { return ts + "\t" + id + "\t" + kind + "\t" + state + "\t" + esc(text); }

    function newer(a, b) { return a.ts !== b.ts ? a.ts > b.ts : a.line > b.line; }

    // merge any number of store texts (or arrays of lines) -> canonical store text
    function merge(texts, now) {
        var best = {}, ids = [], i, j, lines, it;
        for (i = 0; i < texts.length; i++) {
            lines = typeof texts[i] === "string" ? texts[i].split("\n") : texts[i];
            for (j = 0; j < lines.length; j++) {
                it = parseLine(lines[j].replace(/\r$/, ""));
                if (!it) continue;
                if (!best[it.id]) { best[it.id] = it; ids.push(it.id); }
                else if (newer(it, best[it.id])) best[it.id] = it;
            }
        }
        var out = [], cut = (now || new Date().getTime()) - TOMB_MS;
        for (i = 0; i < ids.length; i++) { it = best[ids[i]]; if (!(it.state === "del" && it.ts < cut)) out.push(it); }
        out.sort(function(a, b) { return a.ts !== b.ts ? a.ts - b.ts : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
        var s = HEADER + "\n";
        for (i = 0; i < out.length; i++) s += out[i].line + "\n";
        return s;
    }

    // live items of one kind, in creation order is not stored, so: oldest edit first
    function items(text, kind) {
        var lines = text.split("\n"), r = [], i, it;
        for (i = 0; i < lines.length; i++) { it = parseLine(lines[i]); if (it && it.state !== "del" && (!kind || it.kind === kind)) r.push(it); }
        return r;
    }

    // Change one item. The new version is always newer than the one being replaced, even when this
    // device's clock is behind the device that wrote it (otherwise the edit would silently lose).
    function edit(store, id, kind, state, text, now) {
        now = now || new Date().getTime();
        var lines = store.split("\n"), ts = now, i, it;
        for (i = 0; i < lines.length; i++) { it = parseLine(lines[i]); if (it && it.id === id && it.ts >= ts) ts = it.ts + 1; }
        return merge([store, makeLine(ts, id, kind, state, text)], now);
    }

    var seq = 0;
    function newId(prefix) {
        seq = (seq + 1) % 1296;
        return (prefix || "x") + new Date().getTime().toString(36) + Math.floor(Math.random() * 46656).toString(36) + seq.toString(36);
    }

    return { HEADER: HEADER, esc: esc, unesc: unesc, parseLine: parseLine, makeLine: makeLine, merge: merge, items: items, edit: edit, newId: newId };
})();
if (typeof module !== "undefined") module.exports = HubData;
