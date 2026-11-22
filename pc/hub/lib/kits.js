/* Kitchen Hub v11 - install a new version of the whole kit from a .zip (no GitHub needed).
 * The zip is unpacked into data/kits/<time>/, checked, and becomes the kit the hub runs after its restart (hub.js);
 * the fridge then updates from it like from any kit. Checks before it is used:
 *   - it has kindle/shiftcal/power_loop.sh, pc/hub/hub.js + main.js and cloud/brain.js
 *   - the fridge page and the fridge scripts are the same version (the fridge refuses a mismatch)
 *   - every hub and cloud .js file parses
 * The last 3 kits are kept; going back = choosing an older one (or deleting "kitDir" from config.json). */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
function unpack(zip, dir) {
    const tries = [["tar", ["-xf", zip, "-C", dir]], ["unzip", ["-q", "-o", zip, "-d", dir]]];
    for (const [c, a] of tries) {
        try { cp.execFileSync(c, a, { stdio: "ignore", timeout: 120000, windowsHide: true }); if (fs.readdirSync(dir).length) return true; } catch (e) {}
    }
    return false;
}
function findRoot(dir, depth) {
    if (fs.existsSync(path.join(dir, "kindle", "shiftcal", "power_loop.sh"))) return dir;
    if (depth > 2) return null;
    for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) { const r = findRoot(p, depth + 1); if (r) return r; } }
    return null;
}
function check(root) {
    const need = ["kindle/shiftcal/power_loop.sh", "kindle/shiftcal/mesquite/index.html", "pc/hub/hub.js", "pc/hub/main.js", "cloud/brain.js", "cloud/hubdata.js"];
    const miss = need.filter(f => !fs.existsSync(path.join(root, f)));
    if (miss.length) return "missing " + miss.join(", ");
    const sv = (/^VERSION="([^"]*)"/m.exec(fs.readFileSync(path.join(root, "kindle/shiftcal/power_loop.sh"), "utf8")) || [])[1];
    const pv = (/^var VERSION = "([^"]*)"/m.exec(fs.readFileSync(path.join(root, "kindle/shiftcal/mesquite/index.html"), "utf8")) || [])[1];
    if (!sv || sv !== pv) return "the fridge scripts (" + sv + ") and page (" + pv + ") are different versions";
    const js = [];
    ["pc/hub", "pc/hub/lib", "cloud"].forEach(d => { const p = path.join(root, d); if (fs.existsSync(p)) fs.readdirSync(p).filter(f => /\.js$/.test(f)).forEach(f => js.push(path.join(p, f))); });
    for (const f of js) {
        const r = cp.spawnSync(process.execPath, ["--check", f], { encoding: "utf8", timeout: 30000, windowsHide: true });
        if (r.status !== 0) return path.relative(root, f) + " doesn't parse";
    }
    return "";
}
// zip Buffer -> { ok, version, dir } | { error }
function install(dataDir, zipBuf, now) {
    const kits = path.join(dataDir, "kits"); fs.mkdirSync(kits, { recursive: true });
    const name = "k" + new Date(now || Date.now()).toISOString().replace(/[-:T]/g, "").slice(0, 14), dir = path.join(kits, name), zip = dir + ".zip";
    fs.writeFileSync(zip, zipBuf); fs.mkdirSync(dir);
    const fail = (m) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} try { fs.unlinkSync(zip); } catch (e) {} return { error: m }; };
    if (!unpack(zip, dir)) return fail("couldn't unpack the zip");
    fs.unlinkSync(zip);
    const root = findRoot(dir, 0); if (!root) return fail("no Kitchen Hub kit inside (kindle/shiftcal/power_loop.sh not found)");
    const bad = check(root); if (bad) return fail("kit refused: " + bad);
    const version = (/^VERSION="([^"]*)"/m.exec(fs.readFileSync(path.join(root, "kindle/shiftcal/power_loop.sh"), "utf8")) || [])[1];
    const rel = path.relative(kits, root).split(path.sep).join("/");
    // keep the 3 newest kits
    fs.readdirSync(kits).filter(n => /^k\d{14}$/.test(n)).sort().reverse().slice(3).forEach(n => { try { fs.rmSync(path.join(kits, n), { recursive: true, force: true }); } catch (e) {} });
    return { ok: true, version, dir: rel };
}
module.exports = { install, check };
