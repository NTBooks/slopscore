# Cap'm Slop: master of the Scuttle, proprietor of the Cap'm's Home for AI Slop. Schnitzel's kin, head-only avatar.
# LIGHT: upper-left (10 o'clock). Airbrush register. Built from mascot.head() so the two read as one family:
# same head mass, same droopy eyes, same collar shape, same slop smear. The only additions are soft sub-forms.
# components: navy peacoat collar · 2 ears · head · 2 cheeks · snout w/ nostrils · droopy eyes, one brow raised · smirk
#   · slop smear at the mouth corner + one drip · captain's cap as ONE soft mass: white dome, navy band, slim dark brim, gold anchor badge
import sys, os
sys.path.insert(0, os.path.expanduser("~/.claude/skills/vector-art/scripts"))
from svgkit import *
from parts import eye_droop, brow

HERE = os.path.dirname(os.path.abspath(__file__))

PIG = [(0, "#ffd9dc"), (0.22, "#f7b3ba"), (0.5, "#e88a95"), (0.74, "#c25f6d"), (0.9, "#8f3d4b"), (1, "#c96b78")]
SNOUT = [(0, "#f9c3c8"), (0.4, "#e58a95"), (0.8, "#b6535f"), (1, "#d4737f")]
WHITE = [(0, "#ffffff"), (0.3, "#f4f5f7"), (0.62, "#d9dde4"), (0.86, "#aab2be"), (1, "#dfe4ec")]
NAVY = [(0, "#5a76a8"), (0.25, "#34497a"), (0.55, "#1f2e52"), (0.85, "#111a34"), (1, "#2a3a60")]
GOLD = [(0, "#fff3b0"), (0.25, "#f2cf5a"), (0.55, "#c9962a"), (0.85, "#7a5410"), (1, "#d9b24a")]
GOO = [(0, "#d9f0a0"), (0.2, "#a8cf55"), (0.5, "#6f9a2a"), (0.78, "#3f5f14"), (1, "#7a9a3a")]


def capm():
    hd = blob(300, 312, 118, 106, .03, 10, seed=7)
    snout = "M 260 344 C 260 316 380 316 380 344 C 380 376 260 376 260 344 Z"
    earL = taper(226, 238, 176, 190, 168, 150, 48, 0)
    earR = taper(374, 238, 424, 190, 432, 150, 48, 0)
    cob = "M 386 388 C 386 380 418 380 418 388 L 420 418 C 420 428 384 428 384 418 Z"
    collar = "M 196 404 C 230 384 270 378 300 412 C 330 378 370 384 404 404 L 420 482 L 180 482 Z"
    # the cap is one silhouette: dome + band + brim drawn as a single closed path, then the band and brim as soft sub-forms
    cap = ("M 190 210 C 176 190 150 176 150 150 C 150 128 224 112 300 112 C 376 112 450 128 450 150 C 450 176 424 190 410 210 "
           "C 412 222 412 230 410 234 C 428 236 442 240 442 246 C 442 262 380 270 300 270 C 220 270 158 262 158 246 "
           "C 158 240 172 236 190 234 C 188 230 188 222 190 210 Z")
    top = "M 150 150 C 150 128 224 112 300 112 C 376 112 450 128 450 150 C 450 172 376 188 300 188 C 224 188 150 172 150 150 Z"
    band = "M 190 208 C 230 200 370 200 410 208 L 410 236 C 370 228 230 228 190 236 Z"
    brim = "M 190 232 C 230 240 370 240 410 232 C 428 236 442 240 442 246 C 442 262 380 270 300 270 C 220 270 158 262 158 246 C 158 240 172 236 190 232 Z"
    d = "\n".join([
        ramp("pigH", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="312" r="160" fx="244" fy="252"'),
        ramp("pigE", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="190" r="190" fx="230" fy="160"'),
        ramp("snt", 0, 0, 0, 0, SNOUT, "radial", 'cx="320" cy="344" r="74" fx="292" fy="328"'),
        ramp("coat", 0, 0, 0, 0, NAVY, "radial", 'cx="300" cy="440" r="170" fx="240" fy="400"'),
        ramp("cap", 0, 0, 0, 0, WHITE, "radial", 'cx="300" cy="170" r="190" fx="236" fy="130"'),
        ramp("capTop", 0, 0, 0, 0, [(0, "#ffffff"), (0.5, "#f7f8fa"), (0.85, "#dfe3e9"), (1, "#eef0f4")], "radial", 'cx="300" cy="150" r="160" fx="240" fy="130"'),
        ramp("band", 0, 200, 0, 236, NAVY),
        ramp("brim", 0, 232, 0, 270, [(0, "#2a3450"), (0.45, "#141a2c"), (1, "#0a0d18")]),
        ramp("gold", 196, 0, 404, 0, GOLD),
        ramp("badge", 0, 0, 0, 0, GOLD, "radial", 'cx="300" cy="220" r="24" fx="293" fy="213"'),
        ramp("cob", 0, 0, 0, 0, [(0, "#fff0c0"), (0.3, "#f0cf7a"), (0.65, "#c9a04a"), (0.9, "#8a6420"), (1, "#b08a40")], "radial", 'cx="402" cy="404" r="30" fx="392" fy="392"'),
        shape("p-head", hd), shape("p-snout", snout), shape("p-coat", collar),
        shape("p-cap", cap), shape("p-band", band), shape("p-brim", brim), shape("p-top", top), shape("p-cob", cob),
        masks("H", 182, 206, 418, 418), masks("S", 260, 316, 380, 376), masks("C", 180, 378, 420, 482),
        masks("K", 150, 112, 450, 270), masks("Q", 384, 384, 422, 428),
    ])
    badge = f'''
  <g transform="translate(300 220)">
    <circle r="15" fill="url(#badge)" stroke="#3a2a08" stroke-width="2"/>
    <path d="M 0 -8 L 0 8 M -7 2 Q 0 10 7 2 M -4 -3 H 4" fill="none" stroke="#3a2a08" stroke-width="2.4" stroke-linecap="round"/>
    <circle cy="-9" r="2" fill="none" stroke="#3a2a08" stroke-width="1.8"/>
    <path d="{lens(-10, -6, 3, -11, 2.5, bow=-2)}" fill="#fff" opacity=".6"/>
  </g>'''
    b = f'''
  {ground(300, 496, 150, 16, .35)}
  {part("p-coat", "url(#coat)")}
  {shade("c-coat", "p-coat", 300, 440, 120, 40, "#070b18", "m-litC", "m-rimC", "#9fc0ff", (236, 424, 30, 14, -20), None, sheen_op=.28, core_op=.35)}
  <g clip-path="url(#c-coat)"><path d="M 262 416 L 300 456 L 338 416 L 326 406 L 300 436 L 274 406 Z" fill="#111a33" opacity=".85"/></g>
  {tp(earL, "url(#pigE)")}{tp(earR, "url(#pigE)")}
  <path d="{taper(226, 238, 184, 198, 180, 168, 24, 0)}" fill="#c25f6d" opacity=".8"/>
  <path d="{taper(374, 238, 416, 198, 420, 168, 24, 0)}" fill="#c25f6d" opacity=".8"/>
  {part("p-head", "url(#pigH)")}
  {shade("c-head", "p-head", 300, 312, 118, 106, "#5a1a2a", "m-litH", "m-rimH", "#ffd0d8", (244, 256, 56, 36, -30), (230, 244, 15, 8), sheen_op=.45)}
  <g clip-path="url(#c-head)">
    <ellipse cx="224" cy="346" rx="28" ry="17" fill="#ff7a8a" opacity=".45" filter="url(#b12)"/>
    <ellipse cx="376" cy="346" rx="28" ry="17" fill="#ff7a8a" opacity=".45" filter="url(#b12)"/>
  </g>
  {occ("p-snout", "c-head", 4, 10, "#5a1a2a", .5)}
  {part("p-snout", "url(#snt)")}
  {shade("c-snout", "p-snout", 320, 344, 60, 32, "#5a1a2a", "m-litS", "m-rimS", "#ffd0d8", (290, 332, 26, 12, -20), (282, 328, 8, 4), sheen_op=.5)}
  <ellipse cx="300" cy="348" rx="9" ry="12" fill="#6a1f2c"/><ellipse cx="340" cy="348" rx="9" ry="12" fill="#6a1f2c"/>
  <ellipse cx="297" cy="344" rx="3" ry="4" fill="#ffb3bd" opacity=".6"/><ellipse cx="337" cy="344" rx="3" ry="4" fill="#ffb3bd" opacity=".6"/>
  {eye_droop(256, 292, 23, iris="#3a5a8a", side=-1, look=(.2, .12))}{eye_droop(346, 292, 23, iris="#3a5a8a", side=1, look=(.2, .12))}
  {brow(250, 258, 56, angle=-14, thick=10)}{brow(352, 262, 56, angle=4, thick=10)}
  <path d="M 258 382 Q 302 410 358 374" fill="none" stroke="{OL}" stroke-width="6" stroke-linecap="round"/>
  <path d="M 258 382 Q 302 410 358 374 Q 306 398 258 382 Z" fill="#3a0a14"/>
  {occ("p-cap", "c-head", 0, 12, "#5a1a2a", .5)}
  {part("p-cap", "url(#cap)")}
  {shade("c-cap", "p-cap", 300, 176, 150, 60, "#4a5566", "m-litK", "m-rimK", "#e8f0ff", (236, 168, 50, 22, -20), None, sheen_op=.3, core_op=.4)}
  <g clip-path="url(#c-cap)">
    <path d="{top}" fill="url(#capTop)"/>
    <ellipse cx="300" cy="192" rx="150" ry="10" fill="#4a5566" opacity=".35" filter="url(#b8)"/>
    <path d="{lens(176, 138, 330, 122, 7, bow=-6)}" fill="#fff" opacity=".7" filter="url(#b2)"/>
    <path d="{band}" fill="url(#band)"/>
    <path d="{lens(204, 210, 300, 205, 3.5, bow=-2)}" fill="#8fb0ff" opacity=".35" filter="url(#b2)"/>
    <path d="{brim}" fill="url(#brim)"/>
    <path d="{lens(200, 244, 320, 242, 5, bow=3)}" fill="#fff" opacity=".4" filter="url(#b2)"/>
    <ellipse cx="300" cy="268" rx="130" ry="8" fill="#000" opacity=".4" filter="url(#b8)"/>
    <path d="M 196 236 C 240 244 360 244 404 236" fill="none" stroke="url(#gold)" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="196" cy="236" r="3.5" fill="url(#gold)"/><circle cx="404" cy="236" r="3.5" fill="url(#gold)"/>
  </g>
  {badge}
  <path d="M 348 380 C 366 388 384 396 396 406" fill="none" stroke="{OL}" stroke-width="7" stroke-linecap="round"/>
  <path d="M 348 380 C 366 388 384 396 396 406" fill="none" stroke="#3a2418" stroke-width="4" stroke-linecap="round"/>
  {part("p-cob", "url(#cob)")}
  {shade("c-cob", "p-cob", 402, 404, 18, 20, "#5a3a10", "m-litQ", "m-rimQ", "#ffe8b0", (394, 394, 8, 5, -30), (391, 391, 3, 2), sheen_op=.5, core_op=.5)}
  <g clip-path="url(#c-cob)">
    <path d="M 388 396 H 418 M 388 406 H 418 M 388 416 H 418 M 396 386 V 426 M 406 386 V 426" stroke="#8a6420" stroke-width="1.5" opacity=".45"/>
    <ellipse cx="402" cy="388" rx="14" ry="4" fill="#3a2418" opacity=".85"/>
  </g>
  <circle cx="404" cy="368" r="7" fill="#c9d0da" opacity=".35" filter="url(#b4)"/>
  <circle cx="412" cy="352" r="9" fill="#c9d0da" opacity=".3" filter="url(#b6)"/>
  <circle cx="404" cy="332" r="11" fill="#c9d0da" opacity=".22" filter="url(#b8)"/>
'''
    return write("capm", canvas(d, finish(b, sw=13, color="#2a0c12"), vignette=False, grain=0), outdir=HERE)


if __name__ == "__main__":
    p = capm()
    print(p)
    render(p, scale=1.0)
    with open(p, encoding="utf-8") as f: svg = f.read()
    av = os.path.join(HERE, "capm-avatar.svg")
    with open(av, "w", encoding="utf-8") as f:
        f.write(svg.replace('viewBox="0 0 600 600" width="600" height="600"', 'viewBox="100 96 400 400" width="512" height="512"'))
    render(av, scale=1.0)
