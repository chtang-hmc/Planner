"""
Draws the home-screen icons into public/icons/. Run: python3 scripts/make-icons.py

A cream check on the paper preset's rust accent. Drawn at 1024 and scaled
down, so the stroke stays smooth at 180px. Two variants:

- `any`: the mark fills most of the square. iOS rounds the corners itself.
- `maskable`: the mark kept inside the central 80% safe zone, so Android's
  circle or squircle crop never clips it.

Also writes the browser-tab `src/app/favicon.ico` and the two root
`apple-touch-icon*.png` files iOS falls back to.

Needs Pillow (`pip install pillow`). The PNGs are committed, so only run this
to change the icon.
"""
from pathlib import Path
from PIL import Image, ImageDraw

RUST = (168, 67, 28)      # --accent-500 in the paper preset
CREAM = (250, 248, 244)   # --ground in ui/tokens.css
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'
MASTER = 1024


def draw(scale: float) -> Image.Image:
    """The check, occupying `scale` of the square's width, centred."""
    img = Image.new('RGB', (MASTER, MASTER), RUST)
    d = ImageDraw.Draw(img)
    s = MASTER * scale
    ox, oy = (MASTER - s) / 2, (MASTER - s) / 2
    # A check drawn on a unit square, nudged so its visual centre sits centred.
    pts = [(0.14, 0.53), (0.40, 0.78), (0.88, 0.24)]
    xy = [(ox + x * s, oy + y * s + s * 0.02) for x, y in pts]
    w = int(s * 0.13)
    d.line(xy, fill=CREAM, width=w, joint='curve')
    r = w / 2
    for x, y in (xy[0], xy[-1]):   # round caps
        d.ellipse([x - r, y - r, x + r, y + r], fill=CREAM)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    full, safe = draw(0.62), draw(0.46)
    for size in (192, 512):
        full.resize((size, size), Image.LANCZOS).save(OUT / f'icon-{size}.png', optimize=True)
    safe.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-maskable-512.png', optimize=True)
    touch = full.resize((180, 180), Image.LANCZOS)
    touch.save(OUT / 'apple-touch-icon.png', optimize=True)
    # iOS also asks for these at the site root when a page doesn't say where
    # its icon is (a redirect, an error page). Without them it draws a letter.
    for name in ('apple-touch-icon.png', 'apple-touch-icon-precomposed.png'):
        touch.save(ROOT / 'public' / name, optimize=True)
    # The browser-tab icon, which was still the Next.js starter's triangle.
    # RGBA, not RGB: the ICO embeds its 256px image as a PNG, and Next's build
    # refuses an ICO whose PNG has no alpha channel ("The PNG is not in RGBA
    # format"), though the dev server serves it without complaint.
    full.convert('RGBA').save(ROOT / 'src' / 'app' / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    print('wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
