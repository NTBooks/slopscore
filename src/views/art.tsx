// Inline single-colour art (currentColor) from art/*.svg, bundled as text by the wrangler "Text" rule.
import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import wordmarkSvg from "../../art/wordmark.svg";
import step1 from "../../art/step-1-file.svg";
import step2 from "../../art/step-2-sniff.svg";
import step3 from "../../art/step-3-vote.svg";
import flagSvg from "../../art/flag.svg";
import stampSvg from "../../art/stamp.svg";

const withClass = (svg: string, cls: string, extra = "") => svg.replace("<svg ", `<svg class="${cls}" ${extra} `);

export const Wordmark: FC<{ class?: string }> = (p) => raw(withClass(wordmarkSvg, `wordmark-svg ${p.class ?? ""}`));
export const StepIcon: FC<{ n: 1 | 2 | 3 }> = ({ n }) => raw(withClass([step1, step2, step3][n - 1], "step-icon", 'aria-hidden="true"'));
export const Flag: FC = () => raw(withClass(flagSvg, "flag-icon", 'aria-hidden="true"'));
export const Stamp: FC<{ class?: string; title?: string }> = (p) => raw(withClass(stampSvg, `stamp-svg ${p.class ?? ""}`, `role="img" aria-label="${p.title ?? "Certified Slop"}"`));

/**
 * UI icons, as opposed to the illustrations above. Each is a single stroke path on a 24x24 grid, sized by CSS
 * and coloured by currentColor, so they inherit whatever the surrounding link is doing. They live inline rather
 * than in art/*.svg because they are one path each and are referenced by name from the feed and repo views.
 */
const ICONS = {
  comment: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  manage: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  rocket: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
  star: "m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
} as const;

export type IconName = keyof typeof ICONS;

export const Icon: FC<{ name: IconName; class?: string }> = ({ name, class: cls }) => raw(
  `<svg class="icon ${cls ?? ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`,
);

/** Vote arrows. Filled, not stroked: at 16px a stroked triangle reads as a smudge. */
export const Caret: FC<{ dir: "up" | "down" }> = ({ dir }) => raw(
  `<svg class="caret" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${dir === "up" ? "M12 5 2.5 18h19z" : "M12 19 2.5 6h19z"}"/></svg>`,
);

/** The mascot is a 33 KB filtered SVG; it is served as a static asset and referenced, never inlined. */
export const Mascot: FC<{ class?: string; size?: number }> = ({ class: cls, size }) => (
  <img src="/mascot.svg" alt="A smug pig in a lab coat, clipboard in hand, slop on his chin, at a trough labelled main" class={`mascot-img ${cls ?? ""}`} width={size ?? 200} height={size ?? 200} loading="lazy" />
);
