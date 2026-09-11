# Emoji-style pig face (original drawing in the flat-glossy emoji register), with a little brown slop under the snout.
# LIGHT: upper-left.
# Parts are wrapped in <g id="s-*"> layers so public/schnitzel.js can animate them (ears, head, snout, eyes, mud/jaw, drool).
# Every moving layer carries its own opaque base fill: the multiply shading inside must never blend across layers,
# because a CSS transform isolates the group. Hidden parts (sclera, blush, drool, sparkles) sit at opacity 0 so the
# static <img> render is pixel-identical to the animated one at rest. Regenerate with: python art/emoji_pig.py --no-sheet
# then copy art/emoji-pig.svg to public/mascot.svg.
import sys, os
sys.path.insert(0, os.path.expanduser("~/.claude/skills/vector-art/scripts"))
from svgkit import *
HERE = os.path.dirname(os.path.abspath(__file__))

PINK = [(0, "#ffd1de"), (0.3, "#ff9fbd"), (0.62, "#f2739c"), (0.86, "#d4507e"), (1, "#e8669a")]
SNOUT = [(0, "#ffb8cf"), (0.5, "#f27aa6"), (1, "#c94a7c")]
EAR = [(0, "#ff9fbd"), (0.6, "#e8669a"), (1, "#c94a7c")]
MUD = [(0, "#b98a5a"), (0.35, "#8a5a30"), (0.7, "#5c3a1c"), (1, "#7a4d26")]

def pig():
    head = "M 300 108 C 412 108 486 190 486 300 C 486 412 404 492 300 492 C 196 492 114 412 114 300 C 114 190 188 108 300 108 Z"
    earL = "M 160 176 C 150 132 168 96 192 84 C 214 92 236 118 246 150 C 210 152 182 162 160 176 Z"
    earR = "M 440 176 C 450 132 432 96 408 84 C 386 92 364 118 354 150 C 390 152 418 162 440 176 Z"
    snout = "M 300 292 C 356 292 386 320 386 350 C 386 382 350 402 300 402 C 250 402 214 382 214 350 C 214 320 244 292 300 292 Z"
    mud = "M 262 404 C 256 424 276 440 296 436 C 306 448 322 442 328 432 C 344 438 356 424 348 404 C 322 412 288 412 262 404 Z"
    drip = taper(318, 438, 320, 452, 318, 470, 9, 0)
    d = "\n".join([
        ramp("pk", 0, 0, 0, 0, PINK, "radial", 'cx="300" cy="300" r="200" fx="236" fy="220"'),
        ramp("sn", 0, 0, 0, 0, SNOUT, "radial", 'cx="300" cy="346" r="90" fx="272" fy="322"'),
        ramp("er", 0, 0, 0, 0, EAR, "radial", 'cx="300" cy="120" r="180" fx="240" fy="90"'),
        ramp("mud", 0, 0, 0, 0, MUD, "radial", 'cx="304" cy="420" r="50" fx="290" fy="410"'),
        shape("p-head", head), shape("p-snout", snout), shape("p-mud", mud),
        masks("H", 114, 108, 486, 492), masks("S", 214, 292, 386, 402), masks("M", 256, 402, 358, 448),
    ])
    b = f'''
  <g id="s-all">
  <g id="s-earL"><path d="{earL}" fill="url(#er)"/><path d="M 178 168 C 176 142 186 118 200 106 C 212 116 224 134 230 150 Z" fill="#ff8fb5" opacity=".7"/></g>
  <g id="s-earR"><path d="{earR}" fill="url(#er)"/><path d="M 422 168 C 424 142 414 118 400 106 C 388 116 376 134 370 150 Z" fill="#ff8fb5" opacity=".7"/></g>
  <g id="s-head">
  <use href="#p-head" fill="url(#pk)"/>
  {shade("c-head", "p-head", 300, 300, 186, 192, "#8a2a55", "m-litH", "m-rimH", "#ffd8e6", (236, 210, 74, 46, -30), (214, 196, 20, 10), sheen_op=.5, core_op=.4)}
  <g clip-path="url(#c-head)">
    <ellipse cx="196" cy="352" rx="40" ry="24" fill="#ff5f8f" opacity=".35" filter="url(#b16)"/>
    <ellipse cx="404" cy="352" rx="40" ry="24" fill="#ff5f8f" opacity=".35" filter="url(#b16)"/>
  </g>
  <g id="s-blush" clip-path="url(#c-head)" opacity="0">
    <ellipse cx="196" cy="352" rx="44" ry="26" fill="#ff5f8f" opacity=".5" filter="url(#b16)"/>
    <ellipse cx="404" cy="352" rx="44" ry="26" fill="#ff5f8f" opacity=".5" filter="url(#b16)"/>
  </g>
  {occ("p-snout", "c-head", 3, 8, "#8a2a55", .45)}
  </g>
  <g id="s-snout">
  <use href="#p-snout" fill="url(#sn)"/>
  {shade("c-snout", "p-snout", 300, 346, 86, 54, "#8a2a55", "m-litS", "m-rimS", "#ffd8e6", (262, 318, 34, 16, -20), (250, 312, 10, 5), sheen_op=.5, core_op=.45)}
  <ellipse cx="270" cy="350" rx="14" ry="18" fill="#8a2a55"/><ellipse cx="330" cy="350" rx="14" ry="18" fill="#8a2a55"/>
  <ellipse cx="266" cy="344" rx="4" ry="5" fill="#ff9fbd" opacity=".6"/><ellipse cx="326" cy="344" rx="4" ry="5" fill="#ff9fbd" opacity=".6"/>
  </g>
  <g id="s-eyeL"><ellipse id="s-scleraL" cx="228" cy="258" rx="22" ry="25" fill="#fff" opacity="0"/><g id="s-pupilL"><ellipse cx="228" cy="258" rx="16" ry="19" fill="#2a1420"/><circle cx="223" cy="251" r="5" fill="#fff" opacity=".9"/><circle cx="233" cy="264" r="2.5" fill="#fff" opacity="0" class="s-spark"/></g></g>
  <g id="s-eyeR"><ellipse id="s-scleraR" cx="372" cy="258" rx="22" ry="25" fill="#fff" opacity="0"/><g id="s-pupilR"><ellipse cx="372" cy="258" rx="16" ry="19" fill="#2a1420"/><circle cx="367" cy="251" r="5" fill="#fff" opacity=".9"/><circle cx="377" cy="264" r="2.5" fill="#fff" opacity="0" class="s-spark"/></g></g>
  <g id="s-mud">
  <g id="s-drool" opacity="0"><path id="s-droolp" d="" fill="#eef6ff" stroke="#9bb8d0" stroke-width="2.5" stroke-linejoin="round"/><ellipse id="s-droolh" cx="0" cy="0" rx="2" ry="1" fill="#fff" opacity=".8"/></g>
  <path d="{drip}" fill="url(#mud)"/>
  <use href="#p-mud" fill="url(#mud)"/>
  {shade("c-mud", "p-mud", 304, 422, 46, 22, "#2a1608", "m-litM", "m-rimM", "#e8c79a", (284, 412, 18, 8, -20), (278, 410, 6, 3), sheen_op=.55, core_op=.5)}
  <ellipse cx="318" cy="466" rx="4" ry="2.5" fill="#e8c79a" opacity=".7"/>
  </g>
  </g>
'''
    return write("emoji-pig", canvas(d, b, vignette=False, grain=0), outdir=HERE)

if __name__ == "__main__":
    p = pig(); print(p)
    if "--no-sheet" not in sys.argv:
        sheet([p], os.path.join(HERE, "emoji-sheet.png"), cell=420, scale=1.0)
