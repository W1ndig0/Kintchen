#!/usr/bin/env python3
"""Kitchen Hub 10.10: builds kindle/shiftcal/sleepart.tar, the pictures for the sleep clock.

  clk/<size>/<rot>/<glyph>.png   clock digits (Literata Bold, SIL Open Font License, see OFL-Literata.txt)
                                 size s m l x; rot 0 90 180 270 (the page's screen rotation, CSS clockwise);
                                 glyph 0-9, b (blank), c (colon), am, pm. Every glyph of a size has the same
                                 height, and all digits the same width, so a digit can be swapped in place.
  clk/<size>/metrics.txt         "digit_w colon_w ampm_w height" for the page (rot 0 pixels)
  wx/<kind>/<rot>/<n>.png        weather animation, 8 frames (1.png .. 8.png) + s.png (the still picture)
                                 kinds: sun cloud rain snow fog storm night. 200 x 200, black and white only
                                 (the fast e-ink mode draws 2 tones), drawn as ink line art.

The page draws the same pictures (rot 0, the page rotates itself), so what the loop draws while the Kindle
sleeps matches exactly. Run: python3 kindle/art_src/make_sleepart.py <Literata-700.ttf>
"""
import io, math, os, sys, tarfile
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "shiftcal", "sleepart.tar")
FONT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "Literata-700.ttf")
SIZES = {"s": 84, "m": 128, "l": 180, "x": 300}     # font size in px (x: the night screen, 10.10.2)
ROTS = (0, 90, 180, 270)
FILES = {}                                       # path in the archive -> PNG bytes


def png(img):
    b = io.BytesIO(); img.save(b, "PNG", optimize=True); return b.getvalue()


def put(path, img):
    FILES[path] = png(img)


def rotated(img, rot):
    return img if rot == 0 else img.rotate(-rot, expand=True)     # CSS rotate(90deg) is clockwise


# ---------------------------------------------------------------- clock digits
def clock(sz, px):
    f = ImageFont.truetype(FONT, px)
    fa = ImageFont.truetype(FONT, max(10, round(px * 0.3)))
    digits = "0123456789"
    adv = max(f.getlength(d) for d in digits)
    dw = math.ceil(adv + px * 0.02)
    cw = math.ceil(f.getlength(":") + px * 0.06)
    aw = math.ceil(max(fa.getlength("AM"), fa.getlength("PM")) + px * 0.14)
    tops, bots = [], []
    for ch in digits + ":":
        x0, y0, x1, y1 = f.getbbox(ch, anchor="ls")
        tops.append(y0); bots.append(y1)
    top = min(tops) - max(2, px // 20); bot = max(bots) + max(2, px // 20)
    h = bot - top; base = -top                    # baseline y inside the cell
    cells = {}
    for d in digits:
        im = Image.new("L", (dw, h), 255); dr = ImageDraw.Draw(im)
        dr.text(((dw - f.getlength(d)) / 2, base), d, font=f, fill=0, anchor="ls"); cells[d] = im
    im = Image.new("L", (dw, h), 255); cells["b"] = im
    im = Image.new("L", (cw, h), 255); ImageDraw.Draw(im).text(((cw - f.getlength(":")) / 2, base), ":", font=f, fill=0, anchor="ls"); cells["c"] = im
    for t in ("am", "pm"):
        im = Image.new("L", (aw, h), 255)
        ImageDraw.Draw(im).text((px * 0.1, base), t.upper(), font=fa, fill=0, anchor="ls"); cells[t] = im
    for g, im in cells.items():
        for r in ROTS:
            put("clk/%s/%d/%s.png" % (sz, r, g), rotated(im, r))
    FILES["clk/%s/metrics.txt" % sz] = ("%d %d %d %d\n" % (dw, cw, aw, h)).encode()


# ---------------------------------------------------------------- weather animation (ink line art)
S = 200; K = 4                                    # drawn 4x larger, then reduced and made pure black/white


def canvas():
    im = Image.new("L", (S * K, S * K), 255); return im, ImageDraw.Draw(im)


def finish(im):
    im = im.resize((S, S), Image.LANCZOS)
    return im.point(lambda v: 0 if v < 140 else 255)


def P(x, y): return (x * K, y * K)


def line(d, a, b, w=5): d.line([P(*a), P(*b)], fill=0, width=w * K)


def circle(d, cx, cy, r, w=5, fill=None):
    d.ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], outline=0, width=w * K, fill=fill)


def cloud_shape(d, cx, cy, sc=1.0, w=5):
    # a cloud from three bumps over a flat base, drawn as a filled white shape with a black outline
    parts = [(-34, 6, 26), (-6, -10, 34), (28, 4, 24)]
    for (dx, dy, r) in parts:
        d.ellipse([P(cx + (dx - r) * sc, cy + (dy - r) * sc), P(cx + (dx + r) * sc, cy + (dy + r) * sc)], fill=0)
    d.rectangle([P(cx - 60 * sc, cy + 4 * sc), P(cx + 52 * sc, cy + 30 * sc)], fill=0)
    inner = w
    for (dx, dy, r) in parts:
        r2 = r - inner
        d.ellipse([P(cx + (dx - r2) * sc, cy + (dy - r2) * sc), P(cx + (dx + r2) * sc, cy + (dy + r2) * sc)], fill=255)
    d.rectangle([P(cx - (60 - inner) * sc, cy + 4 * sc), P(cx + (52 - inner) * sc, cy + (30 - inner) * sc)], fill=255)


def sun(n):
    im, d = canvas(); cx = cy = 100
    circle(d, cx, cy, 30, 6)
    a0 = n * (math.pi / 4) / 8                    # rays turn slowly; 8 frames = one ray step
    for i in range(8):
        a = a0 + i * math.pi / 4
        r1, r2 = (44, 70) if i % 2 == 0 else (44, 60)
        line(d, (cx + r1 * math.cos(a), cy + r1 * math.sin(a)), (cx + r2 * math.cos(a), cy + r2 * math.sin(a)), 6)
    return finish(im)


def cloudy(n):
    im, d = canvas()
    off = 8 * math.sin(n / 8 * 2 * math.pi)
    cloud_shape(d, 112 - off * 0.6, 70, 0.75)
    cloud_shape(d, 96 + off, 118, 1.0)
    return finish(im)


def rain(n, storm=False):
    im, d = canvas()
    cloud_shape(d, 100, 70, 1.0)
    for i, x in enumerate((60, 84, 108, 132, 72, 120)):
        y = 112 + ((n * 9 + i * 23) % 70)
        line(d, (x + 4, y), (x - 4, y + 16), 4)
    if storm and n in (3, 4, 7):
        d.polygon([P(104, 104), P(86, 140), P(100, 140), P(90, 176), P(122, 128), P(106, 128), P(116, 104)], fill=0)
    return finish(im)


def snow(n):
    im, d = canvas()
    cloud_shape(d, 100, 66, 1.0)
    for i, x in enumerate((58, 86, 114, 142, 72, 128, 100)):
        y = 108 + ((n * 7 + i * 19) % 80); x2 = x + 5 * math.sin((n + i) / 8 * 2 * math.pi)
        for k in range(3):
            a = k * math.pi / 3
            line(d, (x2 - 7 * math.cos(a), y - 7 * math.sin(a)), (x2 + 7 * math.cos(a), y + 7 * math.sin(a)), 3)
    return finish(im)


def fog(n):
    im, d = canvas()
    for j, y in enumerate((64, 92, 120, 148)):
        sh = 10 * math.sin((n / 8 + j * 0.25) * 2 * math.pi)
        pts = [P(30 + i * 7 + sh, y + 5 * math.sin((i / 20 + j * 0.3 + n / 8) * 2 * math.pi)) for i in range(21)]
        d.line(pts, fill=0, width=6 * K, joint="curve")
    return finish(im)


def night(n):
    im, d = canvas()
    d.ellipse([P(52, 46), P(132, 126)], fill=0)
    d.ellipse([P(74, 36), P(148, 110)], fill=255)          # crescent
    for i, (x, y) in enumerate(((150, 52), (160, 120), (122, 150), (64, 150), (40, 92))):
        r = 7 if (n + i) % 4 < 2 else 3                    # stars twinkle
        line(d, (x - r, y), (x + r, y), 3); line(d, (x, y - r), (x, y + r), 3)
    return finish(im)


KINDS = {"sun": sun, "cloud": cloudy, "rain": rain, "snow": snow, "fog": fog,
         "storm": lambda n: rain(n, True), "night": night}


def weather():
    for kind, fn in KINDS.items():
        frames = [fn(n) for n in range(8)]
        still = fn(0)
        for r in ROTS:
            for n, fr in enumerate(frames):
                put("wx/%s/%d/%d.png" % (kind, r, n + 1), rotated(fr, r))
            put("wx/%s/%d/s.png" % (kind, r), rotated(still, r))


if __name__ == "__main__":
    for sz, px in SIZES.items():
        clock(sz, px)
    weather()
    with tarfile.open(OUT, "w", format=tarfile.USTAR_FORMAT) as t:      # plain tar: busybox reads it
        for path in sorted(FILES):
            info = tarfile.TarInfo(path); info.size = len(FILES[path]); info.mtime = 1795200000; info.mode = 0o644
            t.addfile(info, io.BytesIO(FILES[path]))
    print("%s: %d files, %d KB" % (OUT, len(FILES), os.path.getsize(OUT) // 1024))
