// A "?" beside a key or a criterion that opens to one line on what it means.
//
// CSS only: hovering or focusing the marker shows the line, and a tap on a phone focuses it. No script, nothing
// to load, and the page reads the same with the markers ignored. The words come from lib/glossary.ts; this file
// only decides where they sit.
import type { FC } from "hono/jsx";
import { escapeHtml } from "../lib/markdown";
import { explain } from "../lib/glossary";

export const Why: FC<{ k: string }> = ({ k }) => {
  const text = explain(k);
  return text ? (
    <span class="why">
      <span class="q" tabindex={0} role="button" aria-label={`what ${k} means`}>?</span>
      <span class="tip" role="tooltip">{text}</span>
    </span>
  ) : null;
};

/** The same marker as a string, for prose that is rendered from markdown rather than built in JSX. */
export function whyHtml(k: string): string {
  const text = explain(k);
  return text
    ? `<span class="why"><span class="q" tabindex="0" role="button" aria-label="what ${escapeHtml(k)} means">?</span><span class="tip" role="tooltip">${escapeHtml(text)}</span></span>`
    : "";
}

const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Rendered bulletin prose with a marker after every `<li><strong>key</strong>` the glossary knows.
 *
 * The bulletin is frozen and this adds no word to it: the record a reader copies is unchanged, and a key the
 * glossary has never heard of renders exactly as before.
 */
export function annotateKeys(html: string): string {
  return html.replace(/<li><strong>([^<]+)<\/strong>/g, (m, key: string) => m + whyHtml(unescape(key)));
}
