# The share card for /but-is-it-slop (public/quiz.png, 1200x630).
#
# It is og.svg with the right-hand text block swapped out and nothing else touched: same paper, same
# Schnitzel, same lockup. A questionnaire is not a second brand, and a card that looked like one would
# read as somebody else's page when it lands in a reply.
#
# Run:  python art/quiz.py     (writes art/quiz.svg, art/quiz.png and public/quiz.png)
import os, re, shutil, sys

sys.path.insert(0, os.path.expanduser("~/.claude/skills/vector-art/scripts"))
from svgkit import render

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(os.path.dirname(HERE), "public")

# The last <g> in og.svg is the whole text column. Everything before it is the art.
TEXT = """<g transform="translate(620 132)">
  <text x="0" y="56" font-family="Georgia, 'Times New Roman', serif" font-size="66" font-weight="bold" fill="#1a1a1a">But is it</text>
  <text x="0" y="132" font-family="Georgia, 'Times New Roman', serif" font-size="66" font-weight="bold" fill="#1a1a1a">slop <tspan fill="#c94a7c">though?</tspan></text>
  <text x="2" y="196" font-family="system-ui, Segoe UI, Arial, sans-serif" font-size="26" fill="#6b6b6b">Seven questions. Forty seconds. No login.</text>
  <text x="2" y="236" font-family="system-ui, Segoe UI, Arial, sans-serif" font-size="26" fill="#6b6b6b">Every honest answer lands in the trough.</text>
  <text x="2" y="316" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="22" fill="#6b6b6b">did you read it? &#8594; do you know the language?</text>
  <text x="2" y="372" font-family="system-ui, Segoe UI, Arial, sans-serif" font-size="22" fill="#8a5a30">slopscore.org/but-is-it-slop</text>
</g>"""


def quiz():
    with open(os.path.join(HERE, "og.svg"), encoding="utf-8") as f:
        svg = f.read()
    head, sep, _tail = svg.rpartition('<g transform="translate(620 150)">')
    if not sep:
        raise SystemExit("og.svg no longer ends with the text column; check before regenerating")
    out = os.path.join(HERE, "quiz.svg")
    with open(out, "w", encoding="utf-8") as f:
        f.write(head + TEXT + "\n</svg>\n")
    return out


if __name__ == "__main__":
    p = quiz()
    png = render(p, scale=1.0)
    shutil.copyfile(png, os.path.join(PUBLIC, "quiz.png"))
    print(os.path.join(PUBLIC, "quiz.png"))
