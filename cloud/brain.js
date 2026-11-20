#!/usr/bin/env node
/* Kitchen Hub cloud brain (runs in GitHub Actions every ~15 min; see .github/workflows/kitchen-cloud.yml)
 *
 * Reads your private list gist, and then:
 *   - turns Siri/Shortcut/PC "inbox" notes into locked list items, re-locks anything left plain
 *   - handles requests from the phone (import a recipe from a link, re-roll the meal plan, test push)
 *   - fills an empty week of dinners (meal plan), keeps repeating chores in the calendar
 *   - 10.4: the pantry (food ticked off the list goes into the pantry, staples that run low go on the list)
 *   - phone pushes (ntfy): shift tomorrow / in an hour, events, chores, birthdays, holidays,
 *     a morning briefing, a Sunday week-ahead, weather warnings, "the Kindle went quiet", low battery
 *   - publishes to a second private gist: calendar.ics (subscribe on iPhone/PC), tv.json (locked, for
 *     the TV page) and bundle.txt (weather+news+recipes fetched here, so the Kindle downloads ONE file)
 *
 * The logs of a public repo are public: this script prints counts only, never item text.
 * Env: GIST_ID GIST_TOKEN HUB_PASS [HUB_PASS_OLD] [NTFY_TOPIC] [NTFY_URL] [GH_API] [TZ_HOURS=-7] [BRAIN_NOW=epoch ms, tests]
 *      10.9: HUB_PASS_OLD = the passphrase before a key change (Kindle: Settings > Security > MAKE NEW KEYS). While it
 *      is set, things locked with it still open here and are re-locked with HUB_PASS. Delete it after FINISH.
 *      [SKIP_BUNDLE=1] [OFFLINE=1] [LAT LON]
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const HubData = require("./hubdata.js"), HubCrypt = HubData.HubCrypt, HubCal = HubData.HubCal, HubPantry = HubData.HubPantry;

const API = process.env.GH_API || "https://api.github.com";
const GIST = process.env.GIST_ID, TOKEN = process.env.GIST_TOKEN, PASS = process.env.HUB_PASS || "", PASS_OLD = process.env.HUB_PASS_OLD || "";
const TOPIC = process.env.NTFY_TOPIC || "", NTFY = process.env.NTFY_URL || "https://ntfy.sh";
const TZH = +(process.env.TZ_HOURS || -7);
const NOW = +(process.env.BRAIN_NOW || Date.now());
const OFFLINE = process.env.OFFLINE === "1";
const LAT = process.env.LAT || "53.9171", LON = process.env.LON || "-122.7497";
const REPO_DIR = path.resolve(__dirname, "..");
const out = []; function log(s) { out.push(s); console.log("brain: " + s); }

// ---------- time (the hub lives in one fixed zone, like the Kindle) ----------
function local(ms) { return new Date(ms + TZH * 3600000); }           // read with getUTC*
const L = local(NOW);
function p2(n) { return (n < 10 ? "0" : "") + n; }
function keyOf(d) { return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()); }
function addK(k, n) { const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n)); return keyOf(d); }
const TODAY = keyOf(L), TOMORROW = addK(TODAY, 1), HOUR = L.getUTCHours() + L.getUTCMinutes() / 60, DOW = L.getUTCDay();
function msAt(k, hh, mm) { return Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), hh, mm || 0) - TZH * 3600000; }
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function dayName(k) { return k === TODAY ? "Today" : k === TOMORROW ? "Tomorrow" : DAYS[new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10))).getUTCDay()]; }

// ---------- GitHub ----------
// 10.9: every network call has a time limit, so one stuck request can't eat the whole 8-minute run
async function timed(url, opts, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { ...(opts || {}), signal: ctl.signal }); const body = await r.text(); return { ok: r.ok, status: r.status, body }; }
    finally { clearTimeout(t); }
}
async function gh(method, url, body) {
    let r;
    try {
        r = await timed(url.startsWith("http") ? url : API + url, {
            method, headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github+json", "User-Agent": "KitchenHubBrain", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined
        }, 45000);
    } catch (e) { throw new Error(method + " " + url.replace(/[0-9a-f]{20,}/g, "<id>") + " -> " + (e.name === "AbortError" ? "timed out" : "network error")); }
    if (!r.ok) throw new Error(method + " " + url.replace(/[0-9a-f]{20,}/g, "<id>") + " -> " + r.status);
    return JSON.parse(r.body);
}
async function fileText(f) {
    if (!f) return null;
    if (!f.truncated && typeof f.content === "string") return f.content;
    try { const r = await timed(f.raw_url, {}, 45000); return r.ok ? r.body : null; } catch (e) { return null; }
}
async function get(url, ms, opts) {
    if (OFFLINE) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 15000);
    try { const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 KitchenHub" }, ...(opts || {}) }); return r.ok ? await r.text() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
}

// ---------- store helpers ----------
let store = HubData.HEADER + "\n", storeChanged = false;
function items(kind) {
    return HubData.items(store, kind).map(it => { const t = HubCrypt.unlockAny(it.text, [PASS, PASS_OLD]); return { id: it.id, kind: it.kind, state: it.state, ts: it.ts, text: t === null ? null : t, raw: it.text }; });
}
function edit(id, kind, state, text) { store = HubData.edit(store, id, kind, state, PASS ? HubCrypt.lock(text, PASS) : text, NOW); storeChanged = true; }
function newId() { return HubData.newId("c"); }
function allItems(kind) {      // 10.3: including deleted ones (the book cloud tidies their files)
    const best = {};
    store.split("\n").forEach(l => { const it = HubData.parseLine(l); if (it && it.kind === kind && (!best[it.id] || best[it.id].ts <= it.ts)) best[it.id] = it; });
    return Object.values(best);
}
async function fetchBin(url, ms) {
    if (OFFLINE) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 30000);
    try { const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 KitchenHub" } }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
}
function hasId(id) { return store.split("\n").some(l => { const it = HubData.parseLine(l); return it && it.id === id; }); }

// ---------- inbox: Shortcuts / PC drop plain lines into gist files named inbox-*.txt ----------
//   milk                       -> shopping list      note: back at 6, love you  -> fridge note
//   event: 2026-11-20 15:30 Dentist                   timer: 10                  -> start a 10 min timer
//   chore: weekly:2 19:00 Garbage out                 recipe: https://...        -> import a recipe
function inboxLine(line, mk) {      // mk(): the id for the next item (10.1.2: same ids the fridge gives the same file)
    mk = mk || newId;
    line = String(line).replace(/\r/g, "").trim();
    if (!line || line.charAt(0) === "#") return 0;
    let m;
    if ((m = /^note\s*:\s*(.+)$/i.exec(line))) { edit(mk(), "msg", "open", m[1].replace(/\|/g, "/").slice(0, 280)); return 1; }
    if ((m = /^timer\s*:\s*(\d+)/i.exec(line))) { edit(mk(), "cmd", "open", "timer|" + m[1]); return 1; }
    if ((m = /^recipe\s*:\s*(https?:\/\/\S+)/i.exec(line))) { edit(mk(), "req", "open", "import|" + m[1]); return 1; }
    if ((m = /^event\s*:\s*(\d{4}-\d\d-\d\d)\s+(?:(\d{1,2})(?::(\d\d))?\s*(am|pm|a|p)?\s+(?=\S))?(.+)$/i.exec(line))) {
        // 10.1.2: "3:30pm" / "7pm" times work, and a date like 2026-99-99 is refused instead of making a broken event
        const mo = +m[1].slice(5, 7), da = +m[1].slice(8, 10);
        if (mo < 1 || mo > 12 || da < 1 || da > 31) return 0;
        let t = "";
        if (m[2] !== undefined && (m[3] !== undefined || m[4])) {
            let h = +m[2]; const ap = (m[4] || "").toLowerCase().charAt(0);
            if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
            if (h > 23 || +(m[3] || 0) > 59) return 0;
            t = p2(h) + ":" + (m[3] || "00");
        }
        const title = (t || m[2] === undefined ? m[5] : m[2] + " " + m[5]).replace(/\|/g, "/");
        edit(mk(), "event", "open", HubCal.eventText(m[1], t, title, "")); return 1;
    }
    if ((m = /^chore\s*:\s*(\S+)\s+(?:(\d{1,2}:\d\d)\s+)?(.+)$/i.exec(line))) {
        const txt = HubCal.repeatText(m[1], m[2] ? p2(+m[2].split(":")[0]) + ":" + m[2].split(":")[1] : "", m[3], "");
        if (HubCal.parseRepeat(txt)) { edit(mk(), "repeat", "open", txt); return 1; }
        return 0;
    }
    if ((m = /^(?:shop|buy|list)\s*:\s*(.+)$/i.exec(line))) line = m[1];
    else if (/^(note|timer|recipe|event|chore)\s*:/i.test(line)) return 0;     // 10.1.2: a command that didn't make sense isn't a shopping item ("timer: -5" was added to the list)
    line.split(/\s*,\s*/).forEach(x => { x = x.replace(/\|/g, "/").replace(/[\u0000-\u001f]/g, "").trim(); if (x) edit(mk(), "shop", "open", x.slice(0, 80)); });
    return 1;
}

// ---------- recipe import from a link (JSON-LD recipe card, same as the Kindle reader) ----------
function decodeEnts(s) { return String(s || "").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " "); }
function txt(s) { return decodeEnts(String(s || "")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function recipeFromHtml(html) {
    const blocks = String(html).split(/<script/i).filter(b => /application\/ld\+json/i.test(b.slice(0, 200)));
    for (const b of blocks) {
        const json = b.replace(/^[^>]*>/, "").replace(/<\/script>[\s\S]*$/i, "");
        let ld; try { ld = JSON.parse(json); } catch (e) { continue; }
        const found = [];
        (function walk(o) {
            if (!o || typeof o !== "object") return;
            if (Array.isArray(o)) return o.forEach(walk);
            const t = o["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.indexOf("Recipe") >= 0)) found.push(o);
            if (o["@graph"]) walk(o["@graph"]);
        })(ld);
        if (!found.length) continue;
        const r = found[0], steps = [];
        (function st(s) { if (!s) return; if (typeof s === "string") return void steps.push(txt(s)); if (Array.isArray(s)) return s.forEach(st); if (s.itemListElement) return st(s.itemListElement); if (s.text) steps.push(txt(s.text)); })(r.recipeInstructions);
        const ing = (r.recipeIngredient || []).map(txt).filter(Boolean);
        let img = r.image; if (Array.isArray(img)) img = img[0]; if (img && typeof img === "object") img = img.url;
        return { title: txt(r.name) || "Recipe", ing, steps: steps.filter(Boolean), img: img || "" };
    }
    return null;
}
function recipeText(r, url) { return [r.title].concat(r.ing.map(i => "* " + i), r.steps, url ? ["(from " + url + ")"] : []).join("\n"); }

// ---------- shift / event helpers ----------
function shiftTimes(v) {      // "10:45-2:45p" "1-7:15p" "07-15" "9-5" -> {s:[h,m], e:[h,m]} | null; e.g. [31, 0] = 7 am the next day
    const sp = HubCal.shiftSpan(v);          // 10.1.2: one parser for the hub, the phone and the cloud (this one turned "23-7" into 11pm-7pm)
    if (sp) return { s: [Math.floor(sp.s / 60), sp.s % 60], e: [Math.floor(sp.e / 60), sp.e % 60] };
    const m = /^\s*(\d{1,2})(?::?(\d\d))?\s*([ap])?m?\s*[-\u2013to ]+\s*(\d{1,2})(?::?(\d\d))?\s*([ap])?m?/i.exec(String(v || ""));
    if (!m) return null;
    let sh = +m[1], sm = +(m[2] || 0), eh = +m[4], em = +(m[5] || 0);
    const sa = (m[3] || "").toLowerCase(), ea = (m[6] || "").toLowerCase();
    if (sh > 23 || eh > 24) return null;
    if (sa === "p" && sh < 12) sh += 12; if (sa === "a" && sh === 12) sh = 0;
    if (ea === "p" && eh < 12) eh += 12;
    if (!sa && !/^0/.test(m[1]) && sh < 7) sh += 12;            // "1-7:15p" is an afternoon start
    if (!ea && eh * 60 + em <= sh * 60 + sm && eh < 12) eh += 12;  // "9-5"
    return { s: [sh, sm], e: [eh, em] };
}
function isOff(v) { return !v || /^\s*(off|x|-|vac|vacation|sick|stat|holiday)\s*$/i.test(v); }
function fmtT(h, m) { const ap = h >= 12 ? "pm" : "am"; return (h % 12 || 12) + (m ? ":" + p2(m) : "") + ap; }

function calendar() {
    const sh = {}, sh2 = {}, ev = {};
    items("shift").forEach(it => { if (it.state === "del" || it.text === null) return; const s = HubCal.parseShift(it.text); if (s && s.v) (HubCal.whoOfShift(it.id) === "p2" ? sh2 : sh)[s.date] = s.v; });
    items("event").forEach(it => { if (it.state === "del" || it.text === null) return; const e = HubCal.parseEvent(it.text); if (e) { e.id = it.id; (ev[e.date] = ev[e.date] || []).push(e); } });
    const reps = items("repeat").filter(it => it.state !== "del" && it.text !== null);
    const rx = HubCal.expandRepeats(reps, addK(TODAY, -1), 45);
    Object.keys(rx).forEach(k => { (ev[k] = ev[k] || []).push(...rx[k]); });
    Object.keys(ev).forEach(k => ev[k].sort((a, b) => (a.time || "") < (b.time || "") ? -1 : 1));
    return { sh, sh2, ev, reps };
}
// 9.9: people + pay settings (set on the fridge, Settings > People / Pay)
function peopleCfg() {
    const c = items("cfg").find(it => it.id === "people" && it.text);
    try { const o = c ? JSON.parse(c.text) : null; return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch (e) { return null; }
}

// ---------- ntfy ----------
let pushes = 0;
async function push(title, body, tags, prio) {
    if (!TOPIC) return false;
    if (OFFLINE && !process.env.NTFY_URL) return false;
    try {
        const r = await timed(NTFY + "/" + TOPIC, { method: "POST", body: body, headers: { Title: title.replace(/[^\x20-\x7e]/g, ""), Tags: tags || "fork_and_knife", Priority: String(prio || 3) } }, 20000);
        if (r.ok) pushes++;
        return r.ok;
    } catch (e) { return false; }
}

// ---------- weather (Open-Meteo, same as the Kindle) ----------
const WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm" };
let WX = null;
async function weather() {
    if (WX || process.env.OFFLINE_WX) return WX;
    const t = await get("https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON + "&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum&timezone=Etc%2FGMT%2B7&forecast_days=7");
    try { WX = t ? JSON.parse(t) : null; } catch (e) { WX = null; }
    return WX;
}
function wxLine(w, i) {
    if (!w || !w.daily) return "";
    const d = w.daily;
    return (WMO[d.weather_code[i]] || "") + ", " + Math.round(d.temperature_2m_max[i]) + "\u00b0/" + Math.round(d.temperature_2m_min[i]) + "\u00b0" +
        (d.precipitation_probability_max[i] >= 40 ? ", " + d.precipitation_probability_max[i] + "% precip" : "") + (d.snowfall_sum[i] >= 1 ? ", " + Math.round(d.snowfall_sum[i]) + " cm snow" : "");
}

// ---------- ICS calendar ----------
function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function fold(line) { const o = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; o.push(s.slice(0, n)); s = " " + s.slice(n); } o.push(s); return o.join("\r\n"); }
function dt(k, h, m) { return k.replace(/-/g, "") + "T" + p2(h) + p2(m) + "00"; }
// who: "p1" = the owner's calendar (his shifts + his and shared events), "p2" = the roommate's
function buildIcs(cal, who, name) {
    who = who || "p1";
    const mine = (w) => !w || w === who;
    const L2 = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kitchen Hub//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + (name ? "Kitchen Hub - " + name : "Kitchen Hub"), "X-PUBLISHED-TTL:PT30M", "REFRESH-INTERVAL;VALUE=DURATION:PT30M"];
    const stamp = TODAY.replace(/-/g, "") + "T000000Z";       // stable within a day: the file only changes when the calendar does
    function ev(uid, start, end, title, extra) { L2.push("BEGIN:VEVENT", "UID:" + uid + "@kitchenhub", "DTSTAMP:" + stamp, start, end, fold("SUMMARY:" + icsEsc(title))); (extra || []).forEach(x => L2.push(fold(x))); L2.push("END:VEVENT"); }
    const SH = who === "p2" ? cal.sh2 : cal.sh;
    Object.keys(SH).forEach(k => {
        const v = SH[k]; if (isOff(v)) return;
        const t = shiftTimes(v);
        if (t) { const ek = t.e[0] >= 24 ? addK(k, 1) : k; ev("shift-" + k, "DTSTART:" + dt(k, t.s[0], t.s[1]), "DTEND:" + dt(ek, t.e[0] % 24, t.e[1]), "Shift " + v, ["CATEGORIES:Shift"]); }
        else ev("shift-" + k, "DTSTART;VALUE=DATE:" + k.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addK(k, 1).replace(/-/g, ""), "Shift " + v);
    });
    items("event").forEach(it => {
        if (it.state === "del" || it.text === null) return;
        const e = HubCal.parseEvent(it.text); if (!e || !mine(e.who)) return;
        if (e.time) { const h = +e.time.slice(0, 2), m = +e.time.slice(3); ev(it.id, "DTSTART:" + dt(e.date, h, m), "DTEND:" + (h >= 23 ? dt(addK(e.date, 1), 0, m) : dt(e.date, h + 1, m)), e.title, e.note ? ["DESCRIPTION:" + icsEsc(e.note), "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(e.title), "END:VALARM"] : ["BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(e.title), "END:VALARM"]); }
        else ev(it.id, "DTSTART;VALUE=DATE:" + e.date.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addK(e.date, 1).replace(/-/g, ""), e.title, e.note ? ["DESCRIPTION:" + icsEsc(e.note)] : []);
    });
    const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    cal.reps.forEach(it => {
        const r = HubCal.parseRepeat(it.text); if (!r || (r.who !== "rot" && !mine(r.who))) return;     // 10.1.2: take-turns chores were in nobody's calendar
        const p = r.rule.split(":"); let rr = "", first = TODAY, title = r.title;
        if (p[0] === "daily") rr = "FREQ=DAILY";
        else if (p[0] === "weekly") rr = "FREQ=WEEKLY;BYDAY=" + p[1].split(",").map(x => BYDAY[+x]).join(",");
        else if (p[0] === "every2w") { rr = "FREQ=WEEKLY;INTERVAL=2;BYDAY=" + BYDAY[+p[1]]; first = p[2]; }
        else if (p[0] === "monthly") rr = p[1] === "last" ? "FREQ=MONTHLY;BYMONTHDAY=-1" : +p[1] > 28 ? "FREQ=MONTHLY;BYMONTHDAY=" + Array.from({ length: +p[1] - 27 }, (x, i) => 28 + i).join(",") + ";BYSETPOS=-1" : "FREQ=MONTHLY;BYMONTHDAY=" + p[1];   // the 31st -> last day in short months, like the hub
        else if (p[0] === "yearly") { rr = "FREQ=YEARLY"; first = L.getUTCFullYear() + "-" + p[1]; }
        else if (p[0] === "months") { rr = "FREQ=MONTHLY;INTERVAL=" + (+p[1] || 1); first = p[2]; }        // 10.1.2: was an empty RRULE (some calendar apps then drop the whole feed)
        if (!rr) return;
        if (r.who === "rot") {
            if (p[0] === "weekly") { rr = rr.replace("FREQ=WEEKLY", "FREQ=WEEKLY;INTERVAL=2"); for (let i = 0; i < 14 && HubCal.rotWho(first) !== who; i++) first = addK(first, 1); }
            else title += " (take turns)";
        }
        for (let i = 0; i < 400 && !(HubCal.repeatOn(r, first) && (r.who !== "rot" || p[0] !== "weekly" || HubCal.rotWho(first) === who)); i++) first = addK(first, 1);
        if (r.time) { const h = +r.time.slice(0, 2), m = +r.time.slice(3); ev("rep-" + it.id, "DTSTART:" + dt(first, h, m), "DTEND:" + (h >= 23 ? dt(addK(first, 1), 0, m) : dt(first, h + 1, m)), title, ["RRULE:" + rr]); }
        else ev("rep-" + it.id, "DTSTART;VALUE=DATE:" + first.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addK(first, 1).replace(/-/g, ""), title, ["RRULE:" + rr]);
    });
    [L.getUTCFullYear(), L.getUTCFullYear() + 1].forEach(y => { const H = HubCal.holidays(y); Object.keys(H).forEach(k => ev("hol-" + k, "DTSTART;VALUE=DATE:" + k.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addK(k, 1).replace(/-/g, ""), H[k] + " (stat)", ["TRANSP:TRANSPARENT"])); });
    L2.push("END:VCALENDAR");
    return L2.join("\r\n") + "\r\n";
}

// ---------- bundle: run the Kindle's own sync_data.sh here, ship the results as one text file ----------
function packDir(dir, kindleFiles, stateFiles) {
    let o = "@@KH-BUNDLE " + Math.floor(NOW / 1000) + "\n";
    const add = (rel) => { const f = path.join(dir, rel); if (fs.existsSync(f) && fs.statSync(f).isFile()) { const c = fs.readFileSync(f, "utf8"); o += "@@FILE " + rel + "\n" + c + (c.endsWith("\n") ? "" : "\n"); } };
    kindleFiles.forEach(add); stateFiles.forEach(add);
    const urls = path.join(dir, ".img_urls");
    if (fs.existsSync(urls)) {
        const seen = {}, data = fs.existsSync(path.join(dir, "mesquite/data.js")) ? fs.readFileSync(path.join(dir, "mesquite/data.js"), "utf8") : "";
        fs.readFileSync(urls, "utf8").split("\n").reverse().forEach(l => { const m = /^(img\/[0-9a-z]+\.(jpg|png|gif)) (https?:\S+)$/.exec(l); if (m && !seen[m[1]] && data.indexOf(m[1]) >= 0) { seen[m[1]] = 1; o += "@@IMG " + m[1] + " " + m[3] + "\n"; } });
    }
    return o + "@@END\n";
}
function unpack(text, dir) {
    let cur = null, buf = [];
    const flush = () => { if (cur && /^[A-Za-z0-9._\/-]+$/.test(cur) && cur.indexOf("..") < 0) { const f = path.join(dir, cur); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf.join("\n") + "\n"); } };
    String(text).split("\n").forEach(l => {
        if (l.startsWith("@@FILE ")) { flush(); cur = l.slice(7).trim(); buf = []; }
        else if (l.startsWith("@@IMG ") || l.startsWith("@@END") || l.startsWith("@@KH-BUNDLE")) { flush(); cur = null; buf = []; }
        else if (cur) buf.push(l);
    });
    flush();
}
let KINDLE = null;    // kindle.json: the fridge's own news + markets choices
async function makeBundle(prev) {
    const sync = path.join(REPO_DIR, "kindle", "shiftcal", "sync_data.sh");
    if (!fs.existsSync(sync)) { log("bundle: kindle/shiftcal/sync_data.sh not in the repo - skipped"); return null; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khb-"));
    fs.mkdirSync(path.join(dir, "mesquite/rcp"), { recursive: true });
    if (prev) unpack(prev, dir);                                       // caches, due-stamps and recipe cards carry over
    ["stocks.conf", "news.conf"].forEach(f => { const s = path.join(REPO_DIR, "kindle", f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, f)); });
    if (KINDLE && typeof KINDLE.news === "string") {
        const lines = KINDLE.news.split(";").filter(l => /^https:\/\/[^|\s]+\|[A-Za-z0-9 +.&-]{1,24}\|\d{1,2}$/.test(l));
        if (lines.length) fs.writeFileSync(path.join(dir, "news.conf"), lines.join("\n") + "\n");
    }
    if (KINDLE && typeof KINDLE.stocks === "string" && /^[A-Za-z0-9^=.:&+ -]{1,400}$/.test(KINDLE.stocks.trim())) fs.writeFileSync(path.join(dir, "stocks.conf"), KINDLE.stocks.trim().split(/\s+/).join("\n") + "\n");
    try { fs.unlinkSync(path.join(dir, ".img_urls")); } catch (e) {}
    try { cp.execFileSync("sh", [sync], { env: { ...process.env, HUB_DIR: dir, CLOUD_BUNDLE: "1" }, timeout: 240000, stdio: "ignore" }); }
    catch (e) { log("bundle: sync_data.sh ended early (" + (e.status || e.signal) + ")"); }
    const rcp = fs.readdirSync(path.join(dir, "mesquite/rcp")).filter(f => /\.js$/.test(f)).map(f => "mesquite/rcp/" + f);
    const state = fs.readdirSync(dir).filter(f => /^\.(due_|stocks_cache|whatson_cache|otd_)/.test(f));
    // 10.9.3: a file that isn't valid JavaScript is left out of the bundle (the Kindle keeps its last good copy).
    // A cut-off weather download once made data.js fail on the Kindle: no weather or news, and a page error.
    ["mesquite/data.js", "mesquite/whatson.js", "mesquite/rfeed.js", "mesquite/horo.js"].concat(rcp).forEach(rel => {
        const f = path.join(dir, rel);
        if (!fs.existsSync(f)) return;
        // 10.9.4: Node accepts U+2028/U+2029 and control characters inside strings; the Kindle's older engine
        // may not ("Parse error @ data.js:5" = the news line). They are escaped/removed before the check.
        const raw = fs.readFileSync(f, "utf8"), ls = (raw.match(/[\u2028\u2029]/g) || []).length, ctl = (raw.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
        if (ls || ctl) { fs.writeFileSync(f, raw.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")); log("bundle: " + rel + ": " + ls + " line-separator and " + ctl + " control characters made safe"); }
        try { new Function("window", fs.readFileSync(f, "utf8")); }
        catch (e) { log("bundle: " + rel + " is not valid JavaScript (" + String(e.message).slice(0, 80) + ") - left out"); fs.unlinkSync(f); }
    });
    const b = packDir(dir, ["mesquite/data.js", "mesquite/whatson.js", "mesquite/rfeed.js", "mesquite/horo.js"].concat(rcp), state);
    let data = null;
    try { const t = fs.readFileSync(path.join(dir, "mesquite/data.js"), "utf8"); data = new Function("window", t + "; return window.HUB_DATA;")({}); } catch (e) {}
    let whatson = null, rfeed = null;
    try { whatson = new Function("window", fs.readFileSync(path.join(dir, "mesquite/whatson.js"), "utf8") + "; return window.HUB_WHATSON;")({}); } catch (e) {}
    try { rfeed = new Function("window", fs.readFileSync(path.join(dir, "mesquite/rfeed.js"), "utf8") + "; return window.HUB_RFEED;")({}); } catch (e) {}
    log("bundle: " + Math.round(b.length / 1024) + " KB, " + rcp.length + " recipe cards");
    return { text: b, data, whatson, rfeed };
}
function bundleParts(text) {     // read data out of an existing bundle (when this run doesn't make a new one)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "khr-")); unpack(text, dir);
    const rd = (f, v) => { try { return new Function("window", fs.readFileSync(path.join(dir, f), "utf8") + "; return window." + v + ";")({}); } catch (e) { return null; } };
    return { data: rd("mesquite/data.js", "HUB_DATA"), whatson: rd("mesquite/whatson.js", "HUB_WHATSON"), rfeed: rd("mesquite/rfeed.js", "HUB_RFEED") };
}

// =====================================================================
async function main() {
    if (!GIST || !TOKEN) { log("GIST_ID / GIST_TOKEN secrets are not set - nothing to do"); return; }
    let g = await gh("GET", "/gists/" + GIST);
    const owner = (g.owner && g.owner.login) || process.env.GITHUB_REPOSITORY_OWNER || "";
    store = HubData.merge([(await fileText(g.files["hub.tsv"])) || HubData.HEADER + "\n"], NOW);
    let brain = {}; try { brain = JSON.parse((await fileText(g.files["brain.json"])) || "{}"); } catch (e) {}
    if (!brain || typeof brain !== "object" || Array.isArray(brain)) brain = {};      // 10.1.2: a damaged brain.json starts fresh instead of crashing every run
    let kindle = null; try { kindle = JSON.parse((await fileText(g.files["kindle.json"])) || "null"); } catch (e) {}
    KINDLE = kindle;
    brain.sent = brain.sent || {};
    const brainIn = JSON.parse(JSON.stringify(brain));
    const sent = (k) => !!brain.sent[k], mark = (k) => { brain.sent[k] = NOW; };
    Object.keys(brain.sent).forEach(k => { if (NOW - brain.sent[k] > 12 * 86400000) delete brain.sent[k]; });
    const gistFiles = {};    // main gist edits besides hub.tsv

    // 1. inbox files
    let nIn = 0;
    for (const name of Object.keys(g.files)) {
        if (!/^inbox[-_][A-Za-z0-9._-]*\.txt$/.test(name)) continue;
        const t = await fileText(g.files[name]) || "";
        // 10.1.2: ids from the file name + position, exactly like the fridge's take_inbox, so a file both of them
        // read before it was deleted makes each item once (it used to make doubles)
        const b = name.replace(/[^A-Za-z0-9]/g, "").slice(-20); let n = 0;
        const mk = () => "i" + b + "x" + (n++);
        t.split("\n").forEach(l => { nIn += inboxLine(l, mk); });
        gistFiles[name] = null;
    }
    if (nIn) log("inbox: " + nIn + " lines");

    // 2. re-lock anything plain (Kindle shell / Shortcuts write plain)
    if (PASS) {
        let n = 0;
        HubData.items(store).forEach(it => { if (it.state !== "del" && !HubCrypt.isLocked(it.text)) { store = HubData.edit(store, it.id, it.kind, it.state, HubCrypt.lock(it.text, PASS), NOW); n++; } });
        if (n) { storeChanged = true; log("relocked " + n); }
        // 10.9: after a key change, move things still locked with the old passphrase to the new one
        if (PASS_OLD) {
            let m = 0;
            HubData.items(store).forEach(it => {
                if (it.state === "del" || !HubCrypt.isLocked(it.text) || HubCrypt.unlock(it.text, PASS) !== null) return;
                const t = HubCrypt.unlock(it.text, PASS_OLD);
                if (t !== null) { store = HubData.edit(store, it.id, it.kind, it.state, HubCrypt.lock(t, PASS), NOW); m++; }
            });
            if (m) { storeChanged = true; log("moved " + m + " to the new passphrase"); }
        }
    }

    // 3. requests from the phone
    for (const r of items("req")) {
        if (r.state !== "open" || r.text === null) continue;
        const f = r.text.split("|");
        if (f[0] === "import" && /^https?:\/\//.test(f[1] || "")) {
            const html = await get(f[1], 20000), rec = html ? recipeFromHtml(html) : null;
            if (rec && (rec.ing.length || rec.steps.length)) { edit(newId(), "recipe", "open", recipeText(rec, f[1])); edit(r.id, "req", "done", "import|" + f[1] + "|ok|" + rec.title); log("imported a recipe"); }
            else edit(r.id, "req", "done", "import|" + f[1] + "|fail|" + (html ? "no recipe card on that page" : "could not open the page"));
        } else if (f[0] === "replan") {
            items("plan").forEach(p => { const d = (p.text || "").slice(0, 10); if (d >= TODAY && p.state === "open") edit(p.id, "plan", "del", p.text || ""); });
            brain.replan = 1; edit(r.id, "req", "done", r.text + "|ok");
        } else if (f[0] === "pushtest") {
            const ok = await push("Kitchen Hub", "Test from the cloud brain - phone alerts work.", "white_check_mark");
            edit(r.id, "req", "done", "pushtest|" + (ok ? "ok" : "fail|no NTFY_TOPIC secret or ntfy unreachable"));
        } else if (f[0] === "cloudlog") { brain.wantLog = NOW; edit(r.id, "req", "done", "cloudlog|ok"); }
        else if (f[0] === "book") continue;            // 10.3: the book cloud handles these (step 3b)
        else edit(r.id, "req", "done", r.text + "|fail|unknown request");
    }

    // 3b. 10.3: the book cloud (Gutenberg requests, EPUB conversion, tidying)
    try {
        const bb = process.env.BOOKS_BASE, bget = bb ? (u, ms, o) => get(bb + "/ext/" + encodeURIComponent(u), ms, o) : get, bbin = bb ? (u, ms) => fetchBin(bb + "/ext/" + encodeURIComponent(u), ms) : fetchBin;   // tests
        await require("./books.js")({ gh, items, allItems, edit, newId, log, brain, NOW, TODAY, HubCal, fileText, get: bget, fetchBin: bbin, txt, decodeEnts });
    } catch (e) { log("books failed: " + String(e.message || e).slice(0, 80)); }

    // 3c. 10.4: the pantry (ticked-off food -> pantry, staples that run low -> list); its settings go to the extras
    let pantryCfg = HubPantry.cfg(null);
    try { pantryCfg = require("./pantry.js")({ items, edit, newId, log, brain, TODAY, HubCal, HubPantry }).cfg; }
    catch (e) { log("pantry failed: " + String(e.message || e).slice(0, 80)); }

    // 4. bundle + data for the TV and the meal plan
    let cloud = brain.cloudGist || process.env.CLOUD_GIST_ID || "";
    let cg = null;
    if (cloud) { try { cg = await gh("GET", "/gists/" + cloud); } catch (e) { cloud = ""; } }
    if (!cloud) {
        cg = await gh("POST", "/gists", { public: false, description: "Kitchen Hub cloud (written by the GitHub Action; safe to leave alone)", files: { "README.md": { content: "Made by your Kitchen Hub cloud brain. calendar.ics = subscribe link, tv.json = TV page (locked), bundle.txt = the Kindle's data.\n" } } });
        cloud = cg.id; brain.cloudGist = cloud; log("made the cloud gist");
    }
    const cloudFiles = {};
    const prevBundle = cg && cg.files && cg.files["bundle.txt"] ? await fileText(cg.files["bundle.txt"]) : null;
    let parts = null;
    // 10.10: the Kindle's package (weather, news, recipes) every 2 hours; the runs in between (every 30 min) only
    // do the phone reminders. The Kindle downloads a package only when it has a new one.
    const wantBundle = process.env.SKIP_BUNDLE !== "1" && (!brain.bundleAt || NOW - brain.bundleAt > 115 * 60000 || !prevBundle);
    if (wantBundle) {
        const b = await makeBundle(prevBundle);
        if (b && b.data) { cloudFiles["bundle.txt"] = { content: b.text }; brain.bundleAt = NOW; parts = b; }
    }
    if (!parts && prevBundle) parts = bundleParts(prevBundle);

    // 5. meal plan: fill empty dinners for the next 7 days (never touches a day you changed or cleared)
    const saved = items("recipe").filter(r => r.state === "open" && r.text).map(r => ({ title: r.text.split("\n")[0], src: "saved:" + r.id }));
    const feed = ((parts && parts.rfeed && parts.rfeed.items) || []).map(x => ({ title: decodeEnts(x.t), src: x.l }));
    const pool = saved.concat(feed);
    if (pool.length) {
        const used = {}; items("plan").forEach(p => { if (p.text) used[p.text.split("|")[1]] = 1; });
        let seed = Math.floor(NOW / 86400000) + (brain.replan ? Math.floor(NOW / 60000) : 0), n = 0;
        for (let i = 0; i < 7; i++) {
            const k = addK(TODAY, i), id = "m" + k.replace(/-/g, "");
            if (hasId(id) && (!brain.replan || items("plan").some(p => p.id === id))) continue;   // a day you set or cleared stays that way
            let pick = null;
            for (let t = 0; t < pool.length && !pick; t++) { const c = pool[(seed + t * 7 + i * 3) % pool.length]; if (!used[c.title]) pick = c; }
            pick = pick || pool[(seed + i) % pool.length];
            used[pick.title] = 1; edit(id, "plan", "open", k + "|" + pick.title + "|" + pick.src); n++;
        }
        if (n) log("meal plan: " + n + " dinners");
    }
    delete brain.replan;

    // 5a. 10.1.2: tidy the list once a day so it doesn't grow forever (the hub decrypts every line on every sync)
    if (brain.tidy !== TODAY) {
        brain.tidy = TODAY; let n = 0;
        const old = (it, days) => it.ts && NOW - it.ts > days * 86400000;
        const dated = (id, days) => { const m = /(\d{8})$/.exec(id); return m && m[1] < addK(TODAY, -days).replace(/-/g, ""); };
        for (const it of HubData.items(store)) {
            if (it.state === "del") continue;
            let drop = false;
            if (it.state === "done" && ["cmd", "req", "msg", "pantry", "pkg", "wish", "goal"].indexOf(it.kind) >= 0) drop = old(it, 30);
            else if (it.kind === "chdone") drop = dated(it.id, 120);
            else if (it.kind === "billpd") drop = dated(it.id, 150);
            else if (it.kind === "plan") { const t = HubCrypt.unlockAny(it.text, [PASS, PASS_OLD]); drop = !!(t && /^\d{4}-\d\d-\d\d/.test(t) && t.slice(0, 10) < addK(TODAY, -21)); }
            if (drop) { edit(it.id, it.kind, "del", ""); n++; }
        }
        if (n) log("tidied " + n + " old lines");
    }
    // 5b. 10.0 extras: deals, money, pantry, packages, fun
    let EX = null;
    try {
        let exState = {}; try { exState = cg && cg.files && cg.files["extras_state.json"] ? JSON.parse(await fileText(cg.files["extras_state.json"])) : {}; } catch (e) {} if (!exState || typeof exState !== "object") exState = {};
        const xget = process.env.EXTRAS_BASE ? (u, ms, o) => get(process.env.EXTRAS_BASE + "/ext/" + encodeURIComponent(u), ms, o) : get;   // tests
        const before = JSON.stringify(exState);
        EX = await require("./extras.js")({ items, push, sent, mark, NOW, TODAY, TOMORROW, HOUR, DOW, addK, get: xget, HubCal, decodeEnts, log, state: exState, pantryCfg });
        try { EX.birds = await require("./birds.js")({ get: xget, NOW, TODAY, log, state: exState }); } catch (e) { log("birds failed: " + String(e.message || e).slice(0, 60)); }      // 10.9
        if (JSON.stringify(exState) !== before) cloudFiles["extras_state.json"] = { content: JSON.stringify(exState) };
        const exHash = require("crypto").createHash("sha1").update(JSON.stringify({ ...EX, ts: 0 })).digest("hex");
        if (exHash !== brain.exHash || !(cg && cg.files && cg.files["extra.js"])) {
            cloudFiles["extra.js"] = { content: "window.HUB_EXTRA_LOCKED = " + JSON.stringify(PASS ? HubCrypt.lock(JSON.stringify(EX), PASS) : JSON.stringify(EX)) + ";\n" };
            brain.exHash = exHash;
        }
    } catch (e) { log("extras failed: " + String(e.message || e).slice(0, 80)); }
    // 5c. 10.7: deal photos ride in the bundle as download requests (the Kindle fetches them while it syncs)
    try {
        const cur = cloudFiles["bundle.txt"] ? cloudFiles["bundle.txt"].content : prevBundle;
        if (EX && Array.isArray(EX.deals) && cur && /\n@@END\n?$/.test(cur)) {
            const all = EX.deals.concat(...((EX.week && EX.week.events) || []).map(e => e.deals || []), EX.birds || []);      // 10.9: + bird photos
            const want = all.filter(d => d.img && /^img\/[bd][0-9a-f]{12}\.(jpg|png)$/.test(d.img) && /^https:\/\/\S+$/.test(d.src)).map(d => "@@IMG " + d.img + " " + d.src).filter((l, i, arr) => arr.indexOf(l) === i);
            const kept = cur.replace(/\n@@END\n?$/, "").split("\n").filter(l => !/^@@IMG img\/[bd][0-9a-f]{12}\./.test(l));
            const next = kept.concat(want).join("\n") + "\n@@END\n";
            if (next !== cur) { cloudFiles["bundle.txt"] = { content: next }; log("deals: " + EX.deals.length + " (" + want.length + " photos)"); }
        }
    } catch (e) { log("deal photos failed: " + String(e.message || e).slice(0, 80)); }
    // 5d. 10.10: the extras (deals, money, pantry, fun, birds) ride inside the package too: one download for the
    // Kindle instead of two. Any change to the package gets a new time on its first line, which is what the
    // Kindle looks at (40 bytes) to decide whether to download it.
    try {
        const cur = cloudFiles["bundle.txt"] ? cloudFiles["bundle.txt"].content : prevBundle;
        if (cur && /\n@@END\n?$/.test(cur)) {
            let ex = cloudFiles["extra.js"] ? cloudFiles["extra.js"].content : null;
            const had = /\n@@FILE mesquite\/extra\.js\n/.test(cur);
            if (!ex && !had && cg && cg.files && cg.files["extra.js"]) ex = await fileText(cg.files["extra.js"]);
            let next = cur;
            if (ex) {
                const lines = cur.replace(/\n@@END\n?$/, "").split("\n"), out = [];
                for (let i = 0, skip = false; i < lines.length; i++) {
                    const l = lines[i];
                    if (l.startsWith("@@")) skip = l === "@@FILE mesquite/extra.js";
                    if (!skip) out.push(l);
                }
                next = out.join("\n") + "\n@@FILE mesquite/extra.js\n" + ex.replace(/\n+$/, "") + "\n@@END\n";
            }
            if (next !== cur || cloudFiles["bundle.txt"]) {
                if (next !== cur && prevBundle && next.replace(/^[^\n]*\n/, "") === prevBundle.replace(/^[^\n]*\n/, "")) { delete cloudFiles["bundle.txt"]; }     // nothing really changed
                else cloudFiles["bundle.txt"] = { content: next.replace(/^@@KH-BUNDLE \d+/, "@@KH-BUNDLE " + Math.floor(NOW / 1000)) };
            }
        }
    } catch (e) { log("extras in the package failed: " + String(e.message || e).slice(0, 80)); }

    // 6. pushes
    const cal = calendar();
    if (TOPIC) {
        const w = await weather();
        const quiet = HOUR < 6.5 || HOUR >= 22;
        const plan = {}; items("plan").forEach(p => { if (p.state === "open" && p.text) plan[p.text.slice(0, 10)] = p.text.split("|")[1]; });
        const openList = items("shop").filter(s => s.state === "open" && s.text);
        // morning briefing
        if (HOUR >= 7 && HOUR < 11 && !sent("brief" + TODAY)) {
            mark("brief" + TODAY);
            const lines = [];
            if (w) lines.push("Weather: " + wxLine(w, 0));
            if (HubCal.holiday(TODAY)) lines.push("Holiday: " + HubCal.holiday(TODAY));
            if (cal.sh[TODAY] && !isOff(cal.sh[TODAY])) lines.push("Shift " + cal.sh[TODAY]);
            (cal.ev[TODAY] || []).forEach(e => lines.push((e.time ? HubCal.fmtTime(e.time) + " " : "") + e.title));
            if (plan[TODAY]) lines.push("Dinner: " + plan[TODAY]);
            if (openList.length) lines.push(openList.length + " on the shopping list");
            if (EX) {
                (EX.money && EX.money.bills || []).filter(b => b.date === TODAY && !b.paid).forEach(b => lines.push("Bill due: " + b.name + " $" + b.amount.toFixed(2) + (b.autopay ? " (autopay)" : "")));
                const use = (EX.pantry || []).filter(p => p.expires <= TODAY); if (use.length) lines.push("Use today: " + use.map(p => p.name).join(", "));
                (EX.pkgs || []).filter(p => p.expected === TODAY).forEach(p => lines.push("Package today: " + p.name));
                (EX.nhl || []).filter(g => g.start && keyOf(local(Date.parse(g.start))) === TODAY && g.state !== "OFF" && g.state !== "FINAL").forEach(g => { const t = local(Date.parse(g.start)); lines.push("Canucks: " + g.away + " @ " + g.home + " " + fmtT(t.getUTCHours(), t.getUTCMinutes())); });
                if ((EX.flyers || []).length) lines.push(EX.flyers.length + " list items on sale this week" + (EX.flyerSum && EX.flyerSum.save > 0 ? " (save ~$" + EX.flyerSum.save.toFixed(2) + ")" : ""));
                (EX.wish || []).filter(x => x.hit).forEach(x => lines.push("At your price: " + x.name + " $" + x.price.toFixed(2)));
                (EX.pkgs || []).filter(p => p.expected && p.expected < TODAY).forEach(p => lines.push("Late package: " + p.name));
                const nh = (EX.hot || []).filter(h => h.fresh)[0]; if (nh) lines.push("New hot deal: " + nh.t.slice(0, 80));
            }
            const pc = peopleCfg(), c1 = pc && pc.pay && pc.pay.p1;
            if (c1 && c1.rate > 0) { const r = HubCal.payPeriod(cal.sh, TODAY, c1); if (r.payday === TODAY) lines.push("Payday today"); }
            await push("Good morning - " + DAYS[DOW], lines.join("\n") || "Nothing on today.", "sunrise", 2);
        }
        // shift tomorrow (evening) and shift soon
        if (HOUR >= 20 && HOUR < 22 && cal.sh[TOMORROW] && !isOff(cal.sh[TOMORROW]) && !sent("shtm" + TOMORROW)) {
            mark("shtm" + TOMORROW); await push("Tomorrow: shift " + cal.sh[TOMORROW], (w ? "Weather: " + wxLine(w, 1) : "") + (plan[TOMORROW] ? "\nDinner plan: " + plan[TOMORROW] : ""), "briefcase");
        }
        const st = cal.sh[TODAY] && !isOff(cal.sh[TODAY]) ? shiftTimes(cal.sh[TODAY]) : null;
        if (st) {
            const start = msAt(TODAY, st.s[0], st.s[1]), left = (start - NOW) / 60000;
            if (left > 0 && left <= 75 && !sent("shsoon" + TODAY)) { mark("shsoon" + TODAY); await push("Shift at " + fmtT(st.s[0], st.s[1]), "Starts in " + Math.round(left) + " min." + (w && w.current ? " It's " + Math.round(w.current.temperature_2m) + "\u00b0 out." : ""), "alarm_clock", 4); }
        }
        // timed events and chores
        const choreDone = {}; items("chdone").forEach(c => { if (c.state === "open") choreDone[c.id] = 1; });
        for (const e of (cal.ev[TODAY] || [])) {
            if (!e.time) continue;
            if (e.rep && choreDone["cd" + e.id + TODAY.replace(/-/g, "")]) continue;      // 10.1.1: already ticked off on the fridge/phone
            const at = msAt(TODAY, +e.time.slice(0, 2), +e.time.slice(3)), left = (at - NOW) / 60000, k = "ev" + e.id + TODAY;
            if (e.rep) { if (left <= 0 && left > -20 && !sent(k)) { mark(k); await push(e.title, "Now (" + HubCal.fmtTime(e.time) + ")", "repeat"); } }
            else if (left > 0 && left <= 60 && !sent(k)) { mark(k); await push(e.title + " at " + HubCal.fmtTime(e.time), e.note || "In " + Math.round(left) + " min", "calendar", 4); }
        }
        // birthdays / anniversaries a week and a day ahead
        if (HOUR >= 9 && !quiet) for (const ahead of [7, 1]) {
            const k = addK(TODAY, ahead);
            for (const e of (cal.ev[k] || [])) if (/birthday|bday|b-day|anniversary/i.test(e.title) && !sent("bd" + ahead + e.id + k)) { mark("bd" + ahead + e.id + k); await push((ahead === 1 ? "Tomorrow: " : "In a week: ") + e.title, "Card? Gift? Cake? It's on " + dayName(k) + ".", "birthday"); }
        }
        // payday: the evening before, with this period's gross (from the shifts on the hub)
        const pcf = peopleCfg(), cp1 = pcf && pcf.pay && pcf.pay.p1;
        if (cp1 && cp1.rate > 0 && HOUR >= 19 && HOUR < 22) {
            // the period that pays tomorrow is the one that ended (payLag) days before tomorrow
            const lag = cp1.payLag === undefined ? 6 : +cp1.payLag, endK = addK(TOMORROW, -lag), per = HubCal.periodOf(endK, cp1);
            if (per.to === endK && !sent("pay" + TOMORROW)) {
                mark("pay" + TOMORROW);
                const r = HubCal.payFor(cal.sh, per.from, per.to, cp1);
                await push("Payday tomorrow", "About $" + r.gross.toFixed(2) + " gross for " + r.hours + " h (" + per.from.slice(5) + " to " + per.to.slice(5) + ")" + (r.ot15 + r.ot2 > 0 ? ", incl. " + (r.ot15 + r.ot2) + " h overtime" : "") + ". Before deductions.", "moneybag", 3);
            }
        }
        // 10.1.1: Prince George winter - block heater and snow, the evening before
        if (w && w.daily && HOUR >= 19 && HOUR < 22) {
            const lo = w.daily.temperature_2m_min && w.daily.temperature_2m_min[1], sn = w.daily.snowfall_sum && w.daily.snowfall_sum[1];
            if (lo !== undefined && lo !== null && lo <= -15 && !sent("bh" + TODAY)) { mark("bh" + TODAY); await push("Plug in the block heater", "Low of " + Math.round(lo) + "\u00b0 overnight.", "snowflake", 3); }
            if (sn >= 5 && !sent("sn" + TODAY)) { mark("sn" + TODAY); await push("Snow tomorrow: about " + Math.round(sn) + " cm", "Leave a few minutes early, and the shovel's by the door.", "snowman", 3); }
        }
        // holiday tomorrow
        if (HOUR >= 19 && HOUR < 22 && HubCal.holiday(TOMORROW) && !sent("hol" + TOMORROW)) { mark("hol" + TOMORROW); await push("Tomorrow is " + HubCal.holiday(TOMORROW), "B.C. statutory holiday - check store hours.", "flag-ca", 2); }
        // Sunday: the week ahead
        if (DOW === 0 && HOUR >= 18 && HOUR < 21 && !sent("week" + TODAY)) {
            mark("week" + TODAY);
            const lines = [];
            for (let i = 1; i <= 7; i++) {
                const k = addK(TODAY, i), bits = [];
                if (cal.sh[k] && !isOff(cal.sh[k])) bits.push("shift " + cal.sh[k]);
                (cal.ev[k] || []).forEach(e => bits.push(e.title));
                if (plan[k]) bits.push("dinner: " + plan[k]);
                if (bits.length) lines.push(DAYS[(DOW + i) % 7].slice(0, 3) + ": " + bits.join(" / "));
            }
            if (EX && EX.week) {      // 10.1.1: how the last 7 days went
                const pc2 = peopleCfg(), n1 = (pc2 && pc2.people && pc2.people.p1 && pc2.people.p1.name) || "You", n2 = pc2 && pc2.people && pc2.people.p2 && pc2.people.p2.name;
                const ch = EX.week.chores, bits = ["spent $" + EX.week.spent.toFixed(2)];
                if (ch.p1 + ch.p2) bits.push("chores " + n1 + " " + ch.p1 + (n2 ? ", " + n2 + " " + ch.p2 : ""));
                lines.unshift("Last 7 days: " + bits.join(" / "));
            }
            await push("Your week", lines.join("\n") || "A quiet week.", "spiral_calendar", 2);
        }
        // Saturday: long shopping list
        if (DOW === 6 && HOUR >= 10 && HOUR < 13 && openList.length >= 8 && !sent("shop" + TODAY)) { mark("shop" + TODAY); await push(openList.length + " things on the list", openList.slice(0, 12).map(s => s.text).join(", "), "shopping_cart", 2); }
        // the Kindle: quiet for too long, battery low
        if (kindle && kindle.ts) {
            const quietMin = (NOW / 1000 - kindle.ts) / 60, lim = Math.max(180, (kindle.interval || 60) * 3);
            if (quietMin > lim && !brain.kindleQuiet && !quiet) {      /* 10.1.2: waits for morning instead of a 3 am push */ brain.kindleQuiet = NOW; await push("The fridge hub went quiet", "No check-in for " + Math.round(quietMin / 60) + " h (battery " + (kindle.pct || "?") + "% last time). Dead battery, Wi-Fi, or it crashed.", "warning", 4); }
            if (quietMin < lim) delete brain.kindleQuiet;
            if (kindle.charging) delete brain.battWarned;
            else if (kindle.left7 > 0 && kindle.left7 <= 18 && !kindle.reminded && !brain.battWarned && !quiet) { brain.battWarned = NOW; await push("Fridge hub battery " + kindle.pct + "%", "About " + kindle.left7 + " h left at the current rate.", "battery", 4); }
        }
        // 10.2: the fridge's updater: a new version is running, an update was undone, or one is waiting
        if (kindle && kindle.upd && kindle.upd !== brain.updSeen) {
            const f = String(kindle.upd).split(" ");
            if (brain.updSeen !== undefined) {
                if (f[1] === "healthy") await push("Fridge hub updated to " + f[2], "It started fine. What's new: Settings > Phone > WHAT'S NEW on the fridge.", "sparkles", 2);
                if (f[1] === "rolledback") await push("Fridge update undone", (f[2] || "The new version") + " didn't start properly, so the fridge went back to " + (f[3] || "the last version") + ". Nothing is lost; that version won't be installed again by itself.", "rewind", 4);
            }
            brain.updSeen = kindle.upd;
        }
        if (kindle && kindle.avail && +kindle.auto === 1 && brain.availSeen !== kindle.avail && !quiet) {
            brain.availSeen = kindle.avail;
            await push("Update " + kindle.avail + " is ready for the fridge", "Install it from the phone app (Fridge tab) or Settings > Phone on the fridge.", "arrow_up", 2);
        }
        // new weather warnings
        const ec = process.env.OFFLINE_WX ? null : await get("https://weather.gc.ca/rss/weather/53.912_-122.776_e.xml", 12000);
        if (ec) {
            const warn = ec.split("</entry>").filter(e => /term="Warnings and Watches"/i.test(e)).map(e => (/<title>([^<]*)<\/title>/.exec(e) || [])[1]).filter(t => t && !/No watches or warnings/i.test(t));
            for (const t of warn) { const k = "wx" + TODAY + t.slice(0, 60); if (!sent(k)) { mark(k); await push(decodeEnts(t), "Environment Canada - Prince George", "cloud_with_snow", 4); } }
        }
        if (pushes) log("pushes: " + pushes);
    }

    // 7. calendar.ics + tv.json
    const PC = peopleCfg(), p2name = PC && PC.people && PC.people.p2 && PC.people.p2.name;
    const icsFiles = { "calendar.ics": buildIcs(cal, "p1", p2name ? PC.people.p1.name : "") };
    if (p2name) icsFiles["calendar-p2.ics"] = buildIcs(cal, "p2", p2name);
    for (const f of Object.keys(icsFiles)) if (!cg || !cg.files || !cg.files[f] || (await fileText(cg.files[f])) !== icsFiles[f]) cloudFiles[f] = { content: icsFiles[f] };
    const w = await weather();
    const tv = {
        ts: Math.floor(NOW / 1000), today: TODAY, tz: TZH,
        weather: w ? { now: w.current, daily: w.daily } : null,
        shifts: {}, events: {}, plan: {},
        list: items("shop").filter(s => s.state === "open" && s.text).map(s => s.text),
        notes: items("msg").filter(m => m.state === "open" && m.text).map(m => ({ t: m.text, ts: m.ts })).slice(-5),
        chores: cal.reps.map(r => { const x = HubCal.parseRepeat(r.text); return x ? { title: x.title, when: HubCal.ruleLabel(x.rule) + (x.time ? " " + HubCal.fmtTime(x.time) : "") } : null; }).filter(Boolean),
        recipes: items("recipe").filter(r => r.state === "open" && r.text).slice(0, 40).map(r => { const ls = r.text.split("\n"); return { title: ls[0], ing: ls.slice(1).filter(l => l.indexOf("* ") === 0).map(l => l.slice(2)), steps: ls.slice(1).filter(l => l.trim() && l.indexOf("* ") !== 0 && !/^\(from /.test(l)) }; }),
        news: ((parts && parts.data && parts.data.articles) || []).slice(0, 12).map(a => ({ s: a.s, t: decodeEnts(a.t), b: decodeEnts(String(a.b || "").slice(0, 400)) })),
        alerts: (parts && parts.whatson && parts.whatson.alerts) || [],
        whatson: parts && parts.whatson ? (parts.whatson.pg || []).slice(0, 6).map(a => decodeEnts(a.t)) : [],
        otd: parts && parts.data ? parts.data.onThisDay : null,
        stocks: parts && parts.data ? parts.data.stocks : [],
        feed: ((parts && parts.rfeed && parts.rfeed.items) || []).slice(0, 8).map(x => ({ t: decodeEnts(x.t), s: x.s })),
        kindle: kindle,
        // 10.2: the TV's HOME slide - bills this week, food to use, today's chores (ticked or not), flyer deals, a joke
        home: EX ? {
            bills: ((EX.money && EX.money.bills) || []).filter(b => !b.paid && b.date <= addK(TODAY, 7)).slice(0, 6).map(b => ({ name: b.name, amount: b.amount, date: b.date, autopay: b.autopay })),
            use: (EX.pantry || []).filter(p => p.expires && p.expires <= addK(TODAY, 1)).slice(0, 8).map(p => ({ name: p.name, expires: p.expires })),
            chores: (cal.ev[TODAY] || []).filter(e => e.rep).map(e => ({ title: e.title, who: e.who || "", done: items("chdone").some(c => c.state === "open" && c.id === "cd" + e.id + TODAY.replace(/-/g, "")) })),
            flyers: (EX.flyers || []).slice(0, 4).map(f => ({ name: f.name, price: f.best.price, store: f.best.store })),
            joke: EX.joke || ""
        } : null,
        people: PC ? PC.people : null, shifts2: {},
        pay: PC && PC.pay ? ["p1", "p2"].map(w => { const c = PC.pay[w]; if (!c || !(c.rate > 0) || (w === "p2" && !p2name)) return null; const r = HubCal.payPeriod(w === "p2" ? cal.sh2 : cal.sh, TODAY, c); return { who: w, gross: r.gross, hours: r.hours, from: r.from, to: r.to, payday: r.payday }; }).filter(Boolean) : []
    };
    for (let i = -1; i < 21; i++) { const k = addK(TODAY, i); if (cal.sh[k]) tv.shifts[k] = cal.sh[k]; if (cal.sh2[k]) tv.shifts2[k] = cal.sh2[k]; if (cal.ev[k]) tv.events[k] = cal.ev[k].map(e => ({ time: e.time, title: e.title, rep: !!e.rep, who: e.who || "" })); }
    items("plan").forEach(p => { if (p.state === "open" && p.text && p.text.slice(0, 10) >= addK(TODAY, -1)) tv.plan[p.text.slice(0, 10)] = p.text.split("|")[1]; });
    const tvHash = require("crypto").createHash("sha1").update(JSON.stringify({ ...tv, ts: 0 })).digest("hex");
    if (tvHash !== brain.tvHash || !brain.tvAt || NOW - brain.tvAt > 30 * 60000) {        // unchanged data: refresh every 30 min only
        cloudFiles["tv.json"] = { content: JSON.stringify({ v: 1, locked: PASS ? HubCrypt.lock(JSON.stringify(tv), PASS) : null, plain: PASS ? null : tv }) };
        brain.tvHash = tvHash; brain.tvAt = NOW;
    }

    // 8. write: cloud gist first, then the main gist (merged with a fresh copy: someone may have edited meanwhile)
    if (Object.keys(cloudFiles).length) await gh("PATCH", "/gists/" + cloud, { files: cloudFiles });
    const links = "# written by the cloud brain - the Kindle reads this\nBUNDLE_URL=https://gist.githubusercontent.com/" + owner + "/" + cloud + "/raw/bundle.txt\nCLOUD_GIST=" + cloud + "\nICS_URL=https://gist.githubusercontent.com/" + owner + "/" + cloud + "/raw/calendar.ics\n" + (p2name ? "ICS2_URL=https://gist.githubusercontent.com/" + owner + "/" + cloud + "/raw/calendar-p2.ics\n" : "") + "TV_REF=" + owner + "/" + cloud + "\nEXTRA_URL=https://gist.githubusercontent.com/" + owner + "/" + cloud + "/raw/extra.js\n" + (brain.booksGist ? "BOOKS_URL=https://gist.githubusercontent.com/" + owner + "/" + brain.booksGist + "/raw/\n" : "");
    const before = JSON.stringify({ ...brainIn, lastRun: 0, pushes: 0 });
    brain.v = "10.4";
    brain.ics2 = p2name ? "https://gist.githubusercontent.com/" + owner + "/" + cloud + "/raw/calendar-p2.ics" : ""; brain.owner = owner; brain.pushes = pushes;
    brain.ics = "https://gist.githubusercontent.com/" + owner + "/" + cloud + "/raw/calendar.ics";
    brain.tv = owner + "/" + cloud;
    if (brain.wantLog && kindle && kindle.ts * 1000 > brain.wantLog) delete brain.wantLog;
    // the list gist only changes when something happened (or once an hour, so "cloud brain ran" stays fresh):
    // fewer revisions, and the fridge's/phone's "has it changed?" check stays a tiny 304 most of the time
    const files = { ...gistFiles };
    if (JSON.stringify({ ...brain, lastRun: 0, pushes: 0 }) !== before || !brain.lastRun || NOW - brain.lastRun > 55 * 60000 || pushes || storeChanged || Object.keys(gistFiles).length) {
        brain.lastRun = NOW; files["brain.json"] = { content: JSON.stringify(brain) };
    }
    if ((await fileText(g.files["kindle.conf"])) !== links) files["kindle.conf"] = { content: links };
    if (storeChanged) {
        const fresh = await gh("GET", "/gists/" + GIST);
        store = HubData.merge([store, (await fileText(fresh.files["hub.tsv"])) || ""], NOW);
        files["hub.tsv"] = { content: store };
    }
    if (Object.keys(files).length) await gh("PATCH", "/gists/" + GIST, { files });
    log("done" + (storeChanged ? ", list updated" : "") + (Object.keys(files).length ? "" : " (nothing new to write)"));
}
main().catch(e => { console.error("brain: " + String(e.message || e).replace(/github_pat_\w+/g, "<token>")); process.exit(1); });
