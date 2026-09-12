# The cast: one painting, four nameplates, and the crops the site actually serves.
#
# Unlike the rest of art/, none of this is generated from code — it came out of an image model, so the masters
# are checked in lossless and this script is the only thing that touches them:
#
#   cast-lagoon.png    2172x724 group portrait: the four critics on the beach, Sloptrawler at anchor behind.
#   plate-<name>.png   1024x1536 framed oval bust of one critic, with the name engraved on a brass plate.
#
# The plates carry their own names in the pixels, which is why the cast list needs no captions and why every
# one of them needs real alt text. The group painting supplies the establishing shot, the ship's own portrait
# (she is the only cast member with no plate) and the balcony's OpenGraph card, so it is written out wide.
#
# Boxes are hand-measured on cast-lagoon.png in its own pixels. If that master is ever replaced, re-measure:
# the gaps between the four of them are narrow, and widening any box pulls in somebody else's ear or ladle.
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "cast")

NAMES = ["capm", "princess", "schnitzel", "crusoe"]

# The ship, in the one band of clean water between Princess's snout and Schnitzel's ear.
SHIP = (925, 8, 1220, 377)

# Heads only, square, for the box seats: at 40px a bust is a smudge, so these crop in to the face.
FACES = {
    "capm": (70, 10, 470, 410),
    "princess": (590, 10, 950, 370),
    "schnitzel": (1200, 165, 1560, 525),
    "crusoe": (1800, 0, 2160, 360),
}

CREW = (1400, 467)      # establishing shot + og:image
PLATE = (600, 900)      # 2x the ~300px the cast grid gives each card, so the engraving stays legible
PLATE_INSET = 12        # transparent margin inside the canvas, so a drop-shadow has somewhere to fall
SHIP_OUT = (480, 600)
FACE = (160, 160)       # 4x a 40px avatar

# The plates are painted on cream paper. The page needs the locket, not the paper: the site is dark half the
# time, and the foil and relief effects on /balcony use the alpha channel as their mask, so the shape has to
# be real. Flood-filling in from all eight edge points keys the paper and nothing else — the cream inside the
# engraved nameplate is enclosed by the frame, so the fill never reaches it.
SENTINEL = (255, 0, 255)
PAPER_THRESH = 55       # summed per-channel distance; the palest frame gold is about 105 away from the paper


def key_paper(path):
    """One plate, its paper replaced by transparency, cropped to the locket."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    edges = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2), (w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)]
    for seed in edges:
        ImageDraw.floodfill(im, seed, SENTINEL, thresh=PAPER_THRESH)
    r, g, b = im.split()
    hit = ImageChops.darker(  # 255 only where all three channels are exactly the sentinel
        ImageChops.darker(r.point(lambda v: 255 if v == 255 else 0), g.point(lambda v: 255 if v == 0 else 0)),
        b.point(lambda v: 255 if v == 255 else 0),
    )
    alpha = ImageChops.invert(hit).filter(ImageFilter.GaussianBlur(0.7))  # feathered: the frame has no hard edge
    out = Image.open(path).convert("RGB")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def plate(path):
    """The locket on a uniform transparent canvas: same box for all four, so the grid and the masks agree."""
    art = key_paper(path)
    w, h = PLATE[0] - 2 * PLATE_INSET, PLATE[1] - 2 * PLATE_INSET
    scale = min(w / art.width, h / art.height)
    art = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", PLATE, (0, 0, 0, 0))
    canvas.paste(art, ((PLATE[0] - art.width) // 2, (PLATE[1] - art.height) // 2), art)
    return canvas


def save(im, name, size, quality):
    im.resize(size, Image.LANCZOS).save(
        os.path.join(OUT, name), quality=quality, optimize=True, progressive=True,
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    master = Image.open(os.path.join(HERE, "cast-lagoon.png")).convert("RGB")

    save(master, "crew.jpg", CREW, 83)
    save(master.crop(SHIP), "sloptrawler.jpg", SHIP_OUT, 86)
    for name in NAMES:
        save(master.crop(FACES[name]), f"face-{name}.jpg", FACE, 82)
        plate(os.path.join(HERE, f"plate-{name}.png")).save(
            os.path.join(OUT, f"plate-{name}.webp"), quality=84, method=6, alpha_quality=100,
        )

    total = 0
    for f in sorted(os.listdir(OUT)):
        n = os.path.getsize(os.path.join(OUT, f)); total += n
        print(f"{f:24} {n // 1024:4} KB")
    print(f"{'total':24} {total // 1024:4} KB")


if __name__ == "__main__":
    main()
