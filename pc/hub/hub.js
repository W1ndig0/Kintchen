#!/usr/bin/env node
/* Kitchen Hub v11 - the hub on the PC. Start: node pc/hub/hub.js   ("Install Kitchen Hub.cmd" makes it start at sign-in)
 * This file only chooses which copy of the hub to run:
 *   - a kit installed from a .zip in desktop mode (Status > Install a kit file) - so new versions can come
 *     without GitHub - when config.json names one ("kitDir") and it is there
 *   - otherwise (or if that kit fails to start) the copy next to this file.
 * Everything else is in main.js. Options: --port N   --data DIR   --no-jobs */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : undefined; };
const DATA = arg("data") || process.env.KH_DATA ||
             (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || os.homedir(), "KitchenHub") : path.join(os.homedir(), ".kitchenhub"));
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8")); } catch (e) {}
const note = (m) => { try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(path.join(DATA, "hub.log"), new Date().toISOString().replace("T", " ").slice(0, 19) + " " + m + "\n"); } catch (e) {} };
const kitMain = cfg.kitDir ? path.join(DATA, "kits", cfg.kitDir, "pc", "hub", "main.js") : "";
// 11.2.1: a kit that loads but then crashes within a minute, again and again (run-hub.cmd keeps restarting it), would keep the
// hub down for good. main.js marks the start as good after a minute; three starts in a row that never got there = the built-in copy.
const bootF = path.join(DATA, "kitboot.json");
let boot = {}; try { boot = JSON.parse(fs.readFileSync(bootF, "utf8")) || {}; } catch (e) {}
const same = boot.kit === cfg.kitDir && boot.ok !== true;
if (kitMain && fs.existsSync(kitMain) && !process.env.KH_BUILTIN && same && boot.tries >= 3) {
    note("the installed kit " + cfg.kitDir + " crashed in " + boot.tries + " starts in a row - running the built-in copy (Status > Install a kit file to try another)");
} else if (kitMain && fs.existsSync(kitMain) && !process.env.KH_BUILTIN) {
    try { fs.writeFileSync(bootF, JSON.stringify({ kit: cfg.kitDir, tries: same ? boot.tries + 1 : 1, ok: false })); } catch (e) {}
    try { process.env.KH_KIT = cfg.kitDir; require(kitMain); return; }
    catch (e) { note("the installed kit " + cfg.kitDir + " would not start (" + e.message + ") - running the built-in copy"); delete process.env.KH_KIT; }
}
require("./main.js");
