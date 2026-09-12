# Princess, the Gruel Mistress: SlopScupper's moderator. She runs the kitchen and holds the comments. Schnitzel's kin.
# LIGHT: upper-left (10 o'clock). Airbrush register, same head construction as mascot.head() / capm.py.
# components: white apron bib over a plum dress collar · 2 ears (out from under the cap) · head · 2 cheeks · snout w/ nostrils
#   · almond eyes with lashes, brows pulled in (stern, not angry) · small pursed mouth · white kitchen mob cap as ONE soft mass
#     with a soft ruffled band · tiny gold tiara pinned to the cap, tilted (she is a Princess) · a wooden ladle held up at her
#     right with a gob of gruel in the bowl and one drip · one gruel splash on the apron
import sys, os
sys.path.insert(0, os.path.expanduser("~/.claude/skills/vector-art/scripts"))
from svgkit import *
from parts import eye_almond, brow, crown

HERE = os.path.dirname(os.path.abspath(__file__))

PIG = [(0, "#ffd9dc"), (0.22, "#f7b3ba"), (0.5, "#e88a95"), (0.74, "#c25f6d"), (0.9, "#8f3d4b"), (1, "#c96b78")]
SNOUT = [(0, "#f9c3c8"), (0.4, "#e58a95"), (0.8, "#b6535f"), (1, "#d4737f")]
WHITE = [(0, "#ffffff"), (0.3, "#f4f5f7"), (0.62, "#d9dde4"), (0.86, "#aab2be"), (1, "#dfe4ec")]
PLUM = [(0, "#a86a9c"), (0.25, "#7c4472"), (0.55, "#54294c"), (0.85, "#33162e"), (1, "#5e3256")]
WOOD = [(0, "#d9ad74"), (0.3, "#a97a48"), (0.65, "#6f4622"), (0.9, "#4a2e14"), (1, "#8a5a30")]
GOLD = [(0, "#fff3b0"), (0.25, "#f2cf5a"), (0.55, "#c9962a"), (0.85, "#7a5410"), (1, "#d9b24a")]
GOO = [(0, "#d9f0a0"), (0.2, "#a8cf55"), (0.5, "#6f9a2a"), (0.78, "#3f5f14"), (1, "#7a9a3a")]


def princess():
    hd = blob(300, 312, 118, 106, .03, 10, seed=11)
    snout = "M 262 344 C 262 318 378 318 378 344 C 378 374 262 374 262 344 Z"
    earL = taper(226, 238, 176, 194, 166, 152, 48, 0)
    earR = taper(374, 238, 424, 194, 434, 152, 48, 0)
    collar = "M 196 404 C 230 384 270 378 300 412 C 330 378 370 384 404 404 L 420 482 L 180 482 Z"
    apron = "M 232 420 C 262 402 338 402 368 420 L 380 482 L 220 482 Z"
    # mob cap: a puffy dome with a soft ruffled band; one silhouette
    # mob cap: a soft pouf sitting back on the head, gathered into a ruffled band that rides above the brows
    cap = ("M 190 226 C 166 200 170 150 214 130 C 246 112 354 112 386 130 C 430 150 434 200 410 226 "
           "C 424 232 424 244 412 248 C 400 240 390 252 378 246 C 366 254 352 244 340 250 C 328 244 314 254 300 248 "
           "C 286 254 272 244 260 250 C 248 244 234 254 222 246 C 210 252 200 240 188 248 C 176 244 176 232 190 226 Z")
    band = ("M 190 226 C 230 216 370 216 410 226 C 424 232 424 244 412 248 C 400 240 390 252 378 246 C 366 254 352 244 340 250 "
            "C 328 244 314 254 300 248 C 286 254 272 244 260 250 C 248 244 234 254 222 246 C 210 252 200 240 188 248 C 176 244 176 232 190 226 Z")
    # ladle: handle rises from behind the apron at her right (viewer's right), bowl near the ear
    handle = taper(392, 470, 428, 380, 452, 262, 16, 12)
    bowl = "M 418 262 C 418 236 500 236 500 262 C 500 292 470 306 459 306 C 448 306 418 292 418 262 Z"
    gob = "M 428 262 C 428 250 490 250 490 262 C 490 274 428 274 428 262 Z"
    drip = taper(470, 300, 472, 318, 470, 338, 7, 0)
    splash = "M 286 440 C 280 452 290 462 300 460 C 312 462 318 450 312 440 C 304 448 294 448 286 440 Z"
    d = "\n".join([
        ramp("pigH", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="312" r="160" fx="244" fy="252"'),
        ramp("pigE", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="190" r="190" fx="230" fy="160"'),
        ramp("snt", 0, 0, 0, 0, SNOUT, "radial", 'cx="320" cy="344" r="74" fx="292" fy="328"'),
        ramp("goo", 0, 0, 0, 0, GOO, "radial", 'cx="460" cy="262" r="50" fx="446" fy="254"'),
        ramp("gooS", 0, 0, 0, 0, GOO, "radial", 'cx="300" cy="448" r="30" fx="292" fy="442"'),
        ramp("dress", 0, 0, 0, 0, PLUM, "radial", 'cx="300" cy="440" r="170" fx="240" fy="400"'),
        ramp("apron", 0, 0, 0, 0, WHITE, "radial", 'cx="300" cy="450" r="120" fx="260" fy="420"'),
        ramp("cap", 0, 0, 0, 0, WHITE, "radial", 'cx="300" cy="176" r="150" fx="248" fy="140"'),
        ramp("bandR", 0, 216, 0, 254, [(0, "#f6f7f9"), (0.5, "#d3d8df"), (1, "#a5adb8")]),
        ramp("wood", 392, 262, 452, 470, WOOD),
        ramp("bowl", 0, 0, 0, 0, WOOD, "radial", 'cx="459" cy="270" r="50" fx="440" fy="252"'),
        shape("p-head", hd), shape("p-snout", snout), shape("p-coat", collar), shape("p-apron", apron), shape("p-splash", splash),
        shape("p-cap", cap), shape("p-band", band), shape("p-bowl", bowl), shape("p-gob", gob),
        masks("H", 182, 206, 418, 418), masks("S", 262, 318, 378, 374), masks("C", 180, 378, 420, 482), masks("A", 220, 402, 380, 482),
        masks("K", 166, 112, 434, 254), masks("B", 418, 236, 500, 306), masks("G", 428, 250, 490, 270), masks("P", 280, 438, 320, 462),
    ])
    b = f'''
  {ground(300, 496, 150, 16, .35)}
  {tp(handle, "url(#wood)")}
  <path d="{lens(400, 452, 446, 290, 3, bow=2)}" fill="#ffe0b0" opacity=".45"/>
  {part("p-coat", "url(#dress)")}
  {shade("c-coat", "p-coat", 300, 440, 120, 40, "#1a0818", "m-litC", "m-rimC", "#e0b0ff", (236, 424, 30, 14, -20), None, sheen_op=.3, core_op=.35)}
  {occ("p-apron", "c-coat", 3, 8, "#1a0818", .45)}
  {part("p-apron", "url(#apron)")}
  {shade("c-apron", "p-apron", 300, 450, 74, 40, "#4a5566", "m-litA", "m-rimA", "#e8f0ff", (270, 426, 26, 12, -20), None, sheen_op=.3, core_op=.3)}
  <g clip-path="url(#c-apron)"><path d="M 244 418 Q 300 432 356 418" fill="none" stroke="#b8c0ca" stroke-width="2.5" opacity=".8"/></g>
  {part("p-splash", "url(#gooS)")}
  {shade("c-splash", "p-splash", 300, 450, 16, 11, "#1e3008", "m-litP", "m-rimP", "#e6ffb0", (294, 444, 7, 4, -20), (292, 442, 3, 2), sheen_op=.6, core_op=.5)}
  {tp(earL, "url(#pigE)")}{tp(earR, "url(#pigE)")}
  <path d="{taper(226, 238, 184, 202, 178, 170, 24, 0)}" fill="#c25f6d" opacity=".8"/>
  <path d="{taper(374, 238, 416, 202, 422, 170, 24, 0)}" fill="#c25f6d" opacity=".8"/>
  {part("p-head", "url(#pigH)")}
  {shade("c-head", "p-head", 300, 312, 118, 106, "#5a1a2a", "m-litH", "m-rimH", "#ffd0d8", (244, 256, 56, 36, -30), (230, 244, 15, 8), sheen_op=.45)}
  <g clip-path="url(#c-head)">
    <ellipse cx="224" cy="346" rx="28" ry="17" fill="#ff7a8a" opacity=".5" filter="url(#b12)"/>
    <ellipse cx="376" cy="346" rx="28" ry="17" fill="#ff7a8a" opacity=".5" filter="url(#b12)"/>
  </g>
  {occ("p-snout", "c-head", 4, 10, "#5a1a2a", .5)}
  {part("p-snout", "url(#snt)")}
  {shade("c-snout", "p-snout", 320, 344, 58, 30, "#5a1a2a", "m-litS", "m-rimS", "#ffd0d8", (290, 332, 26, 12, -20), (282, 328, 8, 4), sheen_op=.5)}
  <ellipse cx="302" cy="347" rx="8" ry="11" fill="#6a1f2c"/><ellipse cx="338" cy="347" rx="8" ry="11" fill="#6a1f2c"/>
  <ellipse cx="299" cy="343" rx="3" ry="4" fill="#ffb3bd" opacity=".6"/><ellipse cx="335" cy="343" rx="3" ry="4" fill="#ffb3bd" opacity=".6"/>
  {eye_almond(256, 292, 24, 15, iris="#4a7a3a", look=(.18, .08), lashes=3, tilt=-6)}{eye_almond(346, 292, 24, 15, iris="#4a7a3a", look=(.18, .08), lashes=3, tilt=6)}
  {brow(252, 262, 54, angle=12, thick=9)}{brow(350, 262, 54, angle=-12, thick=9)}
  <path d="M 284 388 Q 300 380 316 388" fill="none" stroke="{OL}" stroke-width="6" stroke-linecap="round"/>
  <path d="M 292 392 Q 300 396 308 392" fill="none" stroke="#3a0a14" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  {occ("p-cap", "c-head", 0, 12, "#5a1a2a", .5)}
  {part("p-cap", "url(#cap)")}
  {shade("c-cap", "p-cap", 300, 176, 118, 60, "#4a5566", "m-litK", "m-rimK", "#e8f0ff", (246, 154, 50, 28, -28), (236, 146, 14, 7), sheen_op=.42, core_op=.32)}
  <g clip-path="url(#c-cap)">
    <path d="{lens(214, 214, 236, 136, 5, bow=-8)}" fill="#4a5566" opacity=".18" filter="url(#b4)"/>
    <path d="{lens(300, 218, 300, 126, 5, bow=-4)}" fill="#4a5566" opacity=".16" filter="url(#b4)"/>
    <path d="{lens(386, 214, 366, 136, 5, bow=8)}" fill="#4a5566" opacity=".2" filter="url(#b4)"/>
    <path d="{band}" fill="url(#bandR)"/>
    <ellipse cx="300" cy="222" rx="118" ry="6" fill="#000" opacity=".22" filter="url(#b8)"/>
    <path d="M 204 236 Q 300 246 396 236" fill="none" stroke="#c9cfd8" stroke-width="2" opacity=".6"/>
  </g>
  <g transform="rotate(-12 346 150)">{crown(346, 150, 60, h=32, color="#e8c050", points=3)}</g>
  {occ("p-bowl", "c-coat", 0, 0, "#000", 0)}
  {part("p-bowl", "url(#bowl)")}
  {shade("c-bowl", "p-bowl", 459, 270, 41, 34, "#2a1608", "m-litB", "m-rimB", "#ffd9a0", (438, 256, 20, 8, -10), (432, 252, 6, 3), sheen_op=.3, core_op=.5)}
  <ellipse cx="459" cy="262" rx="37" ry="13" fill="#3a2210" opacity=".9"/>
  {tp(drip, "url(#goo)")}
  {part("p-gob", "url(#goo)", sw=None)}
  {shade("c-gob", "p-gob", 459, 260, 31, 10, "#1e3008", "m-litG", "m-rimG", "#e6ffb0", (444, 256, 12, 4, -10), (440, 254, 4, 2), sheen_op=.6, core_op=.5)}
  <ellipse cx="470" cy="334" rx="3" ry="2" fill="#e6ffb0" opacity=".8"/>
'''
    return write("princess", canvas(d, finish(b, sw=13, color="#2a0c12"), vignette=False, grain=0), outdir=HERE)


if __name__ == "__main__":
    p = princess()
    print(p)
    render(p, scale=1.0)
    with open(p, encoding="utf-8") as f: svg = f.read()
    av = os.path.join(HERE, "princess-avatar.svg")
    with open(av, "w", encoding="utf-8") as f:
        f.write(svg.replace('viewBox="0 0 600 600" width="600" height="600"', 'viewBox="110 90 400 400" width="512" height="512"'))
    render(av, scale=1.0)
