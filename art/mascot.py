# SlopScore mascot: a smug pig in a lab coat, clipboard in hand, slop on his chin, at a trough labelled "main".
# LIGHT: upper-left (10 o'clock). Airbrush register from the vector-art skill.
# components: body (pink) · lab coat (white, lapels, pocket + pen) · head · snout w/ nostrils · 2 ears · 2 cheeks
#   · droopy smug eyes + one raised brow · smirk · slop on mouth/chin with 3 drips · left arm + clipboard (paper, clip, check)
#   · right arm on trough rim · wooden trough w/ "main" sign · goo in the trough with bubbles · ground shadow
import sys, os
sys.path.insert(0, os.path.expanduser("~/.claude/skills/vector-art/scripts"))
from svgkit import *
from parts import eye_droop, brow

HERE = os.path.dirname(os.path.abspath(__file__))

PIG = [(0, "#ffd9dc"), (0.22, "#f7b3ba"), (0.5, "#e88a95"), (0.74, "#c25f6d"), (0.9, "#8f3d4b"), (1, "#c96b78")]
SNOUT = [(0, "#f9c3c8"), (0.4, "#e58a95"), (0.8, "#b6535f"), (1, "#d4737f")]
COAT = [(0, "#ffffff"), (0.3, "#f4f5f7"), (0.62, "#d9dde4"), (0.86, "#aab2be"), (1, "#dfe4ec")]
GOO = [(0, "#d9f0a0"), (0.2, "#a8cf55"), (0.5, "#6f9a2a"), (0.78, "#3f5f14"), (1, "#7a9a3a")]
TROUGH = [(0, "#c99a63"), (0.25, "#9a6a3c"), (0.5, "#6f4622"), (0.75, "#8a5a30"), (1, "#4a2e14")]
BOARD = [(0, "#b98a58"), (0.5, "#8a5e34"), (1, "#5c3a1c")]


def mascot():
    body = blob(300, 400, 122, 108, .04, 10, seed=3)
    head = blob(300, 232, 112, 100, .03, 10, seed=7)
    snout = "M 262 262 C 262 236 378 236 378 262 C 378 292 262 292 262 262 Z"
    earL = taper(226, 160, 178, 116, 172, 82, 46, 0)
    earR = taper(374, 160, 422, 116, 428, 82, 46, 0)
    armL = taper(206, 372, 160, 372, 150, 322, 40, 26)
    armR = taper(394, 380, 452, 400, 456, 446, 40, 26)
    coat = ("M 222 318 C 190 340 176 380 178 440 L 178 470 L 422 470 L 422 440 C 424 380 410 340 378 318 "
            "L 348 336 L 300 402 L 252 336 Z")
    slop = ("M 256 302 C 246 326 266 340 280 342 C 290 358 304 346 312 354 C 322 364 330 342 338 344 "
            "C 350 346 348 326 336 310 C 318 322 288 320 256 302 Z")
    drip1 = taper(288, 344, 290, 366, 286, 398, 13, 0)
    drip2 = taper(318, 350, 320, 372, 318, 412, 10, 0)
    drip3 = taper(266, 336, 264, 350, 260, 370, 8, 0)
    trough_front = "M 118 452 L 482 452 L 466 548 L 134 548 Z"
    trough_rim = "M 106 440 L 494 440 L 494 458 L 106 458 Z"
    goo_top = "M 118 452 L 482 452 L 478 468 L 122 468 Z"

    d = "\n".join([
        ramp("pigB", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="400" r="170" fx="236" fy="326"'),
        ramp("pigH", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="232" r="150" fx="246" fy="176"'),
        ramp("pigE", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="120" r="180" fx="230" fy="90"'),
        ramp("pigA", 0, 0, 0, 0, PIG, "radial", 'cx="300" cy="380" r="200" fx="220" fy="330"'),
        ramp("snt", 0, 0, 0, 0, SNOUT, "radial", 'cx="320" cy="262" r="70" fx="292" fy="246"'),
        ramp("coat", 0, 0, 0, 0, COAT, "radial", 'cx="300" cy="400" r="180" fx="232" fy="330"'),
        ramp("goo", 0, 0, 0, 0, GOO, "radial", 'cx="300" cy="320" r="90" fx="280" fy="300"'),
        ramp("gooT", 0, 452, 0, 470, [(0, "#b9dc70"), (.5, "#6f9a2a"), (1, "#3f5f14")]),
        ramp("trough", 118, 452, 200, 548, TROUGH),
        ramp("rim", 0, 440, 0, 458, [(0, "#d9ad74"), (.45, "#8a5a30"), (1, "#4a2e14")]),
        ramp("board", 0, 260, 0, 400, BOARD),
        ramp("paper", 0, 0, 0, 0, [(0, "#ffffff"), (.6, "#f1f2f4"), (1, "#cfd4dc")], "radial", 'cx="180" cy="330" r="110" fx="150" fy="290"'),
        shape("p-body", body), shape("p-head", head), shape("p-snout", snout), shape("p-coat", coat), shape("p-slop", slop),
        shape("p-trough", trough_front),
        masks("B", 178, 292, 422, 508), masks("H", 188, 132, 412, 332), masks("S", 262, 232, 378, 292), masks("C", 178, 318, 422, 470),
        masks("G", 258, 298, 360, 348), masks("T", 118, 452, 482, 548),
    ])

    clipboard = f'''
  <g transform="rotate(-14 176 340)">
    <rect x="128" y="262" width="96" height="132" rx="8" fill="url(#board)" stroke="{OL}" stroke-width="7" stroke-linejoin="round"/>
    <rect x="128" y="262" width="96" height="132" rx="8" fill="url(#board)"/>
    <rect x="138" y="280" width="76" height="106" rx="3" fill="url(#paper)"/>
    <rect x="156" y="252" width="40" height="22" rx="6" fill="#8d97a5" stroke="{OL}" stroke-width="3"/>
    <rect x="156" y="252" width="40" height="22" rx="6" fill="#8d97a5"/>
    <path d="{lens(158, 256, 194, 256, 3)}" fill="#fff" opacity=".7"/>
    <path d="M 148 300 H 204 M 148 316 H 196 M 148 332 H 204 M 148 348 H 190" stroke="#9aa3b0" stroke-width="3" stroke-linecap="round"/>
    <path d="M 150 366 L 162 378 L 184 356" fill="none" stroke="#3f8f2a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 150 296 L 156 302 L 168 290" fill="none" stroke="#3f8f2a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 190 312 L 196 318 L 208 306" fill="none" stroke="#3f8f2a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>'''

    sign = f'''
  <g transform="rotate(4 420 500)">
    <rect x="382" y="482" width="80" height="34" rx="5" fill="#f3e9cf" stroke="{OL}" stroke-width="5" stroke-linejoin="round"/>
    <rect x="382" y="482" width="80" height="34" rx="5" fill="#f3e9cf"/>
    <text x="422" y="506" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="20" font-weight="bold" text-anchor="middle" fill="#2a1e14">main</text>
  </g>'''

    b = f'''
  {ground(300, 556, 200, 22, .55)}
  {tp(earL, "url(#pigE)")}{tp(earR, "url(#pigE)")}
  <path d="{taper(226, 160, 186, 122, 184, 96, 22, 0)}" fill="#c25f6d" opacity=".8"/>
  <path d="{taper(374, 160, 414, 122, 416, 96, 22, 0)}" fill="#c25f6d" opacity=".8"/>
  {tp(armR, "url(#pigA)")}
  {part("p-body", "url(#pigB)")}
  {shade("c-body", "p-body", 300, 400, 122, 108, "#5a1a2a", "m-litB", "m-rimB", "#ffd0d8", (236, 334, 44, 28, -30), (226, 322, 12, 6), sheen_op=.4)}
  {part("p-coat", "url(#coat)")}
  {shade("c-coat", "p-coat", 300, 400, 122, 80, "#4a5566", "m-litC", "m-rimC", "#e8f0ff", (232, 372, 40, 26, -30), None, sheen_op=.35, core_op=.35)}
  <g clip-path="url(#c-coat)">
    <path d="M 252 336 L 300 402 L 348 336 L 330 322 L 300 366 L 270 322 Z" fill="#c9cfd8" opacity=".9"/>
    <path d="M 300 402 L 300 470" stroke="#9aa3b0" stroke-width="2.5"/>
    <circle cx="300" cy="420" r="4" fill="#6b7480"/><circle cx="300" cy="446" r="4" fill="#6b7480"/>
    <rect x="336" y="404" width="46" height="36" rx="3" fill="none" stroke="#9aa3b0" stroke-width="2.5"/>
    <rect x="352" y="392" width="8" height="30" rx="3" fill="#e84a3a" stroke="{OL}" stroke-width="2"/>
    <path d="M 218 322 Q 190 360 186 470" fill="none" stroke="#7a8592" stroke-width="3" opacity=".6" filter="url(#b2)"/>
  </g>
  {occ("p-head", "c-coat", 4, 12, "#2a2f3a", .5)}
  {tp(armL, "url(#pigA)")}
  {part("p-head", "url(#pigH)")}
  {shade("c-head", "p-head", 300, 232, 112, 100, "#5a1a2a", "m-litH", "m-rimH", "#ffd0d8", (246, 178, 52, 34, -30), (232, 166, 14, 7), sheen_op=.45)}
  <g clip-path="url(#c-head)">
    <ellipse cx="228" cy="264" rx="26" ry="16" fill="#ff7a8a" opacity=".45" filter="url(#b12)"/>
    <ellipse cx="372" cy="264" rx="26" ry="16" fill="#ff7a8a" opacity=".45" filter="url(#b12)"/>
  </g>
  {occ("p-snout", "c-head", 4, 10, "#5a1a2a", .5)}
  {part("p-snout", "url(#snt)", sw=None)}
  {shade("c-snout", "p-snout", 320, 262, 58, 30, "#5a1a2a", "m-litS", "m-rimS", "#ffd0d8", (290, 250, 26, 12, -20), (282, 246, 8, 4), sheen_op=.5)}
  <ellipse cx="300" cy="266" rx="9" ry="12" fill="#6a1f2c"/><ellipse cx="340" cy="266" rx="9" ry="12" fill="#6a1f2c"/>
  <ellipse cx="297" cy="262" rx="3" ry="4" fill="#ffb3bd" opacity=".6"/><ellipse cx="337" cy="262" rx="3" ry="4" fill="#ffb3bd" opacity=".6"/>
  {eye_droop(258, 200, 22, iris="#4a2a1a", side=-1, look=(.22, .18))}{eye_droop(346, 200, 22, iris="#4a2a1a", side=1, look=(.22, .18))}
  {brow(254, 166, 54, angle=8, thick=10)}{brow(350, 156, 56, angle=-18, thick=10)}
  <path d="M 262 300 Q 302 326 356 292" fill="none" stroke="{OL}" stroke-width="6" stroke-linecap="round"/>
  <path d="M 262 300 Q 302 326 356 292 Q 306 314 262 300 Z" fill="#3a0a14"/>
  {tp(drip1, "url(#goo)")}{tp(drip2, "url(#goo)")}{tp(drip3, "url(#goo)")}
  {part("p-slop", "url(#goo)")}
  {shade("c-slop", "p-slop", 300, 328, 48, 26, "#1e3008", "m-litG", "m-rimG", "#e6ffb0", (282, 310, 20, 8, -20), (276, 306, 6, 3), sheen_op=.6, core_op=.55)}
  <ellipse cx="288" cy="394" rx="5" ry="3" fill="#e6ffb0" opacity=".8"/><ellipse cx="318" cy="408" rx="4" ry="2.5" fill="#e6ffb0" opacity=".8"/>
  <path d="{lens(272, 312, 330, 318, 5, bow=-6)}" fill="#f4ffd0" opacity=".55"/>
  {clipboard}
  <path d="{trough_rim}" fill="url(#rim)" stroke="{OL}" stroke-width="8" stroke-linejoin="round"/>
  {part("p-trough", "url(#trough)")}
  {shade("c-trough", "p-trough", 300, 500, 182, 48, "#2a1608", "m-litT", "m-rimT", "#ffd9a0", (200, 480, 60, 14, -6), None, sheen_op=.3, core_op=.5)}
  <g clip-path="url(#c-trough)">
    <path d="M 118 470 L 482 470 M 126 500 L 474 500 M 132 528 L 468 528" stroke="#3a2210" stroke-width="2.5" opacity=".55"/>
    <path d="M 150 452 L 146 548 M 300 452 L 300 548 M 450 452 L 446 548" stroke="#3a2210" stroke-width="3" opacity=".5"/>
  </g>
  <path d="{trough_rim}" fill="url(#rim)"/>
  <path d="{lens(112, 444, 300, 444, 4)}" fill="#fff" opacity=".45"/>
  <path d="{goo_top}" fill="url(#gooT)"/>
  <ellipse cx="200" cy="460" rx="7" ry="4" fill="#d9f0a0" opacity=".7"/><ellipse cx="330" cy="461" rx="5" ry="3" fill="#d9f0a0" opacity=".7"/><ellipse cx="410" cy="459" rx="8" ry="4" fill="#d9f0a0" opacity=".6"/>
  {sign}
  <g>
    <ellipse cx="458" cy="446" rx="22" ry="14" fill="#5a1a2a" stroke="{OL}" stroke-width="6"/>
    <ellipse cx="458" cy="446" rx="22" ry="14" fill="#6a1f2c"/>
    <path d="M 458 434 L 458 452" stroke="#2a0c12" stroke-width="3"/>
    <path d="{lens(444, 440, 470, 438, 3, bow=-2)}" fill="#ffb3bd" opacity=".5"/>
  </g>
  <g transform="rotate(-14 176 340)">
    <ellipse cx="214" cy="386" rx="20" ry="13" fill="#5a1a2a" stroke="{OL}" stroke-width="6"/>
    <ellipse cx="214" cy="386" rx="20" ry="13" fill="#6a1f2c"/>
    <path d="M 214 375 L 214 392" stroke="#2a0c12" stroke-width="3"/>
    <path d="{lens(202, 380, 226, 379, 3, bow=-2)}" fill="#ffb3bd" opacity=".5"/>
  </g>
'''
    return write("mascot", canvas(d, finish(b, sw=13, color="#2a0c12"), vignette=False, grain=0), outdir=HERE)


if __name__ == "__main__":
    p = mascot()
    print(p)
    sheet([p], os.path.join(HERE, "mascot-sheet.png"), cell=560, scale=1.0)
