/* Kitchen Hub 10.9 — bird of the hour (run by brain.js).
 * Birds you can see around Prince George, B.C., picked for the season: 12 a day, one per hour on the Kindle
 * (hour % 12). Photos come from Wikipedia's lead image for each species (hosted on Wikimedia Commons) and are only
 * used when Commons says the licence is free (Creative Commons or public domain); the photographer and licence are
 * kept and shown. The Kindle downloads the small thumbnails like deal photos (@@IMG lines in the bundle).
 * Looked-up birds are remembered in the extras state for 30 days, so a normal run makes no requests at all.
 */
const crypto = require("crypto");
// [display name, Wikipedia title, y = all year | w = winter (Nov-Mar) | s = summer (Apr-Oct), short note]
const BIRDS = [
    ["Black-capped Chickadee", "Black-capped chickadee", "y", "Hides thousands of seeds each fall and remembers where."],
    ["Boreal Chickadee", "Boreal chickadee", "y", "A brown-capped cousin of the spruce forests."],
    ["Common Raven", "Common raven", "y", "Can mimic other birds, engines and even voices."],
    ["Bald Eagle", "Bald eagle", "y", "Gathers along the Fraser and Nechako when the fish run."],
    ["Canada Jay", "Canada jay", "y", "The 'whisky jack': nests in late winter, in the snow."],
    ["Black-billed Magpie", "Black-billed magpie", "y", "Builds a domed nest with a side door."],
    ["Downy Woodpecker", "Downy woodpecker", "y", "Canada's smallest woodpecker; loves suet feeders."],
    ["Hairy Woodpecker", "Hairy woodpecker", "y", "Looks like a Downy, with a much longer bill."],
    ["Pileated Woodpecker", "Pileated woodpecker", "y", "Crow-sized; leaves big rectangular holes in snags."],
    ["Red-breasted Nuthatch", "Red-breasted nuthatch", "y", "Walks head-first down tree trunks."],
    ["Pine Grosbeak", "Pine grosbeak", "y", "Tame winter finch that comes to mountain ash berries."],
    ["Evening Grosbeak", "Evening grosbeak", "y", "Flocks of yellow, black and white at feeders."],
    ["Ruffed Grouse", "Ruffed grouse", "y", "Drums its wings to make a low, thumping sound."],
    ["Spruce Grouse", "Spruce grouse", "y", "So calm it's called the 'fool hen'."],
    ["Great Horned Owl", "Great horned owl", "y", "Hoots on winter nights; nests as early as February."],
    ["Northern Pygmy-Owl", "Northern pygmy owl", "y", "Fist-sized owl that hunts in daylight."],
    ["Red Crossbill", "Red crossbill", "y", "Crossed bill pries seeds out of cones."],
    ["White-winged Crossbill", "White-winged crossbill", "y", "Can raise young in any month the cones are good."],
    ["Pine Siskin", "Pine siskin", "y", "Streaky little finch with flashes of yellow."],
    ["Dark-eyed Junco", "Dark-eyed junco", "y", "Flashes white tail feathers when it flies off."],
    ["American Goshawk", "American goshawk", "y", "A fierce forest hawk that chases prey through trees."],
    ["American Dipper", "American dipper", "y", "Walks underwater in fast streams, even in winter."],
    ["Mallard", "Mallard", "y", "Stays wherever the water stays open."],
    ["Bohemian Waxwing", "Bohemian waxwing", "w", "Winter flocks strip berry trees in town."],
    ["Common Redpoll", "Common redpoll", "w", "Survives -40 nights; stores seeds in a throat pouch."],
    ["Snow Bunting", "Snow bunting", "w", "Arrives from the Arctic with the snow."],
    ["Northern Shrike", "Northern shrike", "w", "A songbird that hunts like a hawk."],
    ["American Robin", "American robin", "s", "Often the first song of spring in town."],
    ["Varied Thrush", "Varied thrush", "s", "Its long, buzzy whistle echoes through wet forests."],
    ["Swainson's Thrush", "Swainson's thrush", "s", "Spiralling flute song at dusk in June."],
    ["Cedar Waxwing", "Cedar waxwing", "s", "Passes berries beak to beak down a branch."],
    ["Rufous Hummingbird", "Rufous hummingbird", "s", "Flies here from Mexico; fights over every feeder."],
    ["Tree Swallow", "Tree swallow", "s", "Iridescent blue; nests in boxes near water."],
    ["Yellow-rumped Warbler", "Yellow-rumped warbler", "s", "The 'butter-butt': first warbler back in spring."],
    ["White-crowned Sparrow", "White-crowned sparrow", "s", "Bold black-and-white stripes on its head."],
    ["Song Sparrow", "Song sparrow", "s", "Each male sings a few songs of its own."],
    ["Red-winged Blackbird", "Red-winged blackbird", "s", "'Conk-la-ree!' from every cattail marsh."],
    ["Mountain Bluebird", "Mountain bluebird", "s", "Sky-blue; hovers over open fields."],
    ["Osprey", "Osprey", "s", "Dives feet-first for fish in the rivers."],
    ["Sandhill Crane", "Sandhill crane", "s", "Rattling calls from flocks passing over in spring and fall."],
    ["Common Loon", "Common loon", "s", "Its haunting call carries across northern lakes."],
    ["Belted Kingfisher", "Belted kingfisher", "s", "Rattles as it flies the riverbanks."],
    ["Northern Flicker", "Northern flicker", "s", "A woodpecker that feeds on ants on the ground."],
    ["Canada Goose", "Canada goose", "s", "V-shaped flocks mark the turn of the seasons."],
    ["Great Blue Heron", "Great blue heron", "s", "Stands still for minutes, then strikes."],
    ["Red-tailed Hawk", "Red-tailed hawk", "s", "Perches on poles along the highways."]
];
function seasonOf(month) { return month >= 3 && month <= 9 ? "s" : "w"; }      // 0-based month: Apr-Oct summer
function clean(html) { return String(html || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(); }
function pick(list, seed, n) {        // the same 12 all day, different tomorrow
    const scored = list.map(b => ({ b, k: crypto.createHash("sha1").update(seed + "|" + b[1]).digest("hex") }));
    return scored.sort((x, y) => x.k < y.k ? -1 : 1).slice(0, n).map(x => x.b);
}
module.exports = async function birdsOfTheDay(ctx) {
    const { get, NOW, TODAY, log } = ctx, st = ctx.state;
    st.birds = st.birds || {};
    const month = +TODAY.slice(5, 7) - 1, season = seasonOf(month);
    const today = pick(BIRDS.filter(b => b[2] === "y" || b[2] === season), TODAY, 16);
    const UA = { headers: { "User-Agent": "KitchenHub/10.9 (personal kitchen display; github.com/W1ndig0/Kintchen)", Accept: "application/json" } };
    const J = async u => { const t = await get(u, 15000, UA); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    let looked = 0;
    const out = [];
    for (const b of today) {
        if (out.length >= 12) break;
        let c = st.birds[b[1]];
        if ((!c || NOW - c.at > 30 * 864e5) && looked < 6) {
            looked++;
            const s = await J("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(b[1].replace(/ /g, "_")));
            const th = s && s.thumbnail && s.thumbnail.source, orig = s && s.originalimage && s.originalimage.source;
            let ok = null;
            if (th && orig && /^https:\/\/upload\.wikimedia\.org\//.test(th)) {
                const file = decodeURIComponent(orig.split("/").pop());
                const m = await J("https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=" + encodeURIComponent("File:" + file));
                const pages = m && m.query && m.query.pages, p = pages && pages[Object.keys(pages)[0]], md = p && p.imageinfo && p.imageinfo[0] && p.imageinfo[0].extmetadata;
                const lic = md && md.LicenseShortName && clean(md.LicenseShortName.value);
                if (lic && /^(CC|Public domain|PD)/i.test(lic)) ok = { src: th, by: clean(md.Artist && md.Artist.value).slice(0, 60) || "Wikimedia Commons", lic: lic.slice(0, 24), page: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(file.replace(/ /g, "_")) };
            }
            c = st.birds[b[1]] = { at: NOW, ...(ok || { none: 1 }) };
        }
        if (!c || c.none) continue;
        const img = "img/b" + crypto.createHash("sha1").update(c.src).digest("hex").slice(0, 12) + (/\.png$/i.test(c.src) ? ".png" : ".jpg");
        out.push({ n: b[0], note: b[3], img, src: c.src, by: c.by, lic: c.lic, page: c.page });
    }
    if (looked) log("birds: looked up " + looked + ", " + out.length + " ready");
    return out;
};
module.exports.BIRDS = BIRDS;
