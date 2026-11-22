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
if (kitMain && fs.existsSync(kitMain) && !process.env.KH_BUILTIN) {
    try { process.env.KH_KIT = cfg.kitDir; require(kitMain); return; }
    catch (e) { note("the installed kit " + cfg.kitDir + " would not start (" + e.message + ") - running the built-in copy"); delete process.env.KH_KIT; }
}
require("./main.js");
