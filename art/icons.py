# Single-colour UI art for SlopScore: step icons, the "Certified Slop" stamp, the report flag, the wordmark.
# Everything uses currentColor so it follows the page's light/dark text colour. Emits plain SVG, no filters.
import os
HERE = os.path.dirname(os.path.abspath(__file__))

def svg(name, body, vb="0 0 64 64", extra=""):
    out = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" {extra}>{body}</svg>'
    with open(os.path.join(HERE, f"{name}.svg"), "w", encoding="utf-8") as f:
        f.write(out)
    return out

# Step 1: a file with frontmatter dashes and a commit dot
step1 = svg("step-1-file", '''
<path d="M16 6h22l12 12v40H16z"/><path d="M38 6v12h12"/>
<path d="M22 26h20M22 33h12M22 40h20"/>
<circle cx="14" cy="50" r="4" fill="currentColor" stroke="none"/><path d="M14 46V34"/>
''')

# Step 2: the crawler sniffs: a snout with motion lines
step2 = svg("step-2-sniff", '''
<ellipse cx="34" cy="36" rx="18" ry="13"/>
<circle cx="27" cy="36" r="3" fill="currentColor" stroke="none"/><circle cx="41" cy="36" r="3" fill="currentColor" stroke="none"/>
<path d="M8 22c4 2 4 6 0 8M6 32c4 2 4 6 0 8M60 22c-4 2-4 6 0 8M62 32c-4 2-4 6 0 8"/>
<path d="M22 22c4-8 20-8 24 0"/>
''')

# Step 3: graded: up and down arrows with a score line
step3 = svg("step-3-vote", '''
<path d="M20 30L32 14l12 16H36v10h-8V30z" fill="currentColor" stroke="none"/>
<path d="M44 50 32 56 20 50"/>
<path d="M14 44h36"/>
''')

# Report flag: muted, tiny
flag = svg("flag", '''<path d="M16 58V10"/><path d="M16 12h34l-8 10 8 10H16z" fill="currentColor" stroke="none" opacity=".85"/>''')

# Certified Slop stamp: rotated rounded rect, double border, two-line text. currentColor, so it can be tinted.
stamp = svg("stamp", '''
<g transform="rotate(-12 150 60)">
  <rect x="14" y="14" width="272" height="92" rx="14" stroke-width="6"/>
  <rect x="26" y="26" width="248" height="68" rx="8" stroke-width="2.5" stroke-dasharray="6 5"/>
  <text x="150" y="58" text-anchor="middle" font-family="Impact, 'Arial Black', system-ui, sans-serif" font-size="30" letter-spacing="3" fill="currentColor" stroke="none">CERTIFIED SLOP</text>
  <text x="150" y="82" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="15" letter-spacing="2" fill="currentColor" stroke="none">INSPECTED · GRADED · EATEN</text>
</g>
<ellipse cx="150" cy="60" rx="140" ry="52" fill="currentColor" stroke="none" opacity=".05"/>
''', vb="0 0 300 120")

# Wordmark: heavy slab text with a slop drip off the first S. Fill currentColor; the drip uses the accent via CSS var with fallback.
wordmark = svg("wordmark", '''
<text x="0" y="46" font-family="'Arial Black', Impact, system-ui, sans-serif" font-size="46" font-weight="900" letter-spacing="-1" fill="currentColor" stroke="none">Slop<tspan fill="var(--accent, #e8669a)">Score</tspan></text>
<path d="M14 48c0 8-2 14-2 20 0 4 4 4 4 0 0-6-2-12-2-20z" fill="var(--accent, #e8669a)" stroke="none"/>
<path d="M156 48c0 5-1 9-1 13 0 3 3 3 3 0 0-4-2-8-2-13z" fill="var(--accent, #e8669a)" stroke="none"/>
''', vb="0 0 268 72", extra='role="img" aria-label="SlopScore"')

print("\n".join(os.listdir(HERE)))
