// The colour tokens, held to WCAG AA (4.5:1 for text) in both themes.
//
// Two commits in a row fixed one contrast failure each, and the pass that fixed them introduced four more,
// because nothing in the build reads the stylesheet. This does. It parses the two :root blocks out of
// public/style.css and checks every (text, background) pair the site actually draws. A new token pair that
// is text on a surface belongs in PAIRS; a colour change that drops a pair under 4.5 fails here, not on a
// reader's screen.
import { describe, it, expect } from "vitest";
// Inlined by vitest.config.ts (define): the workers runtime has no fs, and a ?raw import of a .css file
// comes back empty under this pool because the CSS pipeline claims it first.
declare const __STYLE_CSS__: string;
const css = __STYLE_CSS__;

/** The `--name: #hex` declarations of one :root block. `dark` picks the block inside the dark media query. */
function tokens(dark: boolean): Record<string, string> {
  const re = dark ? /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/ : /(?:^|\n):root \{([^}]*)\}/;
  const block = css.match(re)?.[1];
  if (!block) throw new Error(`no ${dark ? "dark" : "light"} :root block in ${css.length} bytes starting ${JSON.stringify(css.slice(0, 120))}`);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function lum(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Text token on surface token. "#fff" is the one literal the stylesheet uses as text (the login button). */
const PAIRS: [string, string, string][] = [
  ["body text", "fg", "bg"],
  ["body text on a panel", "fg", "panel"],
  ["body text on the darker panel", "fg", "panel-2"],
  ["muted text", "muted", "bg"],
  ["muted text on a panel", "muted", "panel"],
  ["muted text on the darker panel (tag bar)", "muted", "panel-2"],
  ["links", "link", "bg"],
  ["links on the darker panel", "link", "panel-2"],
  ["visited links", "visited", "bg"],
  ["visited links on a panel (mobile cards)", "visited", "panel"],
  ["filled buttons", "btn-fg", "btn-bg"],
  ["accent text (tabs, strip label, agent bar, heckle verdicts)", "accent-text", "bg"],
  ["accent text on a panel", "accent-text", "panel"],
  ["accent text on the darker panel", "accent-text", "panel-2"],
  ["gate passed", "ok-fg", "panel"],
  ["gate failed", "bad-fg", "panel"],
  ["gate passed on the page", "ok-fg", "bg"],
  ["gate failed on the page", "bad-fg", "bg"],
  ["chips", "chip-fg", "chip"],
  ["login button", "#fff", "login-bg"],
];

for (const dark of [false, true]) {
  describe(`${dark ? "dark" : "light"} theme meets AA`, () => {
    const t = tokens(dark);
    const color = (name: string) => (name.startsWith("#") ? name : t[name]);
    it("defines every token the pairs name", () => {
      for (const [, fg, bg] of PAIRS) {
        expect(color(fg), fg).toBeDefined();
        expect(color(bg), bg).toBeDefined();
      }
    });
    for (const [what, fg, bg] of PAIRS) {
      it(`${what}: ${fg} on ${bg}`, () => {
        expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}

describe("the contrast maths", () => {
  it("agrees with the known ends of the scale", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 1);
    expect(contrast("#fff", "#fff")).toBeCloseTo(1, 5);
  });
});
