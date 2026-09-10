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

/** The mascot is a 33 KB filtered SVG; it is served as a static asset and referenced, never inlined. */
export const Mascot: FC<{ class?: string; size?: number }> = ({ class: cls, size }) => (
  <img src="/mascot.svg" alt="A smug pig in a lab coat, clipboard in hand, slop on his chin, at a trough labelled main" class={`mascot-img ${cls ?? ""}`} width={size ?? 200} height={size ?? 200} loading="lazy" />
);
