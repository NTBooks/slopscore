// The sea: every repo the trawl's searches return, read off the search response and nothing else.
//
// The trough is the listing sample, and it is filtered before anything is read: a star floor, a licence the
// site can quote from, a personal owner. Right rules for a public page; wrong rules for a count, because
// between them they drop most of the labelled population before it has been seen. This module is the count.
// It works the same searches with no star clause, keeps one row per repo with the facts GitHub's search
// response already carried, and stops there. No README is read, no model is asked, no page is made, and no
// name in the table is ever shown on the site.
//
// Everything here is pure. The walk that fills the table is src/jobs/seen.ts; the nightly count of it is
// src/jobs/trends.ts; the rules are written down at /method (v4).
import type { GhRepo } from "./github";
import type { DenyRow } from "./denylist";
import type { ToolRow } from "./tools";
import { BUILT_WITH_RE, PERMISSIVE, STATIC, groundOfQuery, pickCandidates, trawlQueryList, trawlSignals, type Registry } from "./virtual";

/** The searches without a star clause and without a push clause: the walk supplies its own date windows. */
export const SEEN_BASE = "fork:false archived:false template:false is:public";

/** Every search the sea works, in the same order and with the same keys as the trough's (lib/virtual trawlQueryList). */
export function seenQueryList(rows: ToolRow[] = []): string[] {
  return trawlQueryList(rows).map((q) => `${q} ${SEEN_BASE}`);
}

/** One sighting, as the table stores it. Facts only; the description and README are deliberately absent. */
export interface SeenRow {
  full_name: string;
  repo_id: number;
  ground: number;
  query: string;
  at: number;
  stars: number;
  forks: number;
  size_kb: number;
  open_issues: number;
  language: string | null;
  license: string | null;
  owner_type: string;
  created_at: number;
  pushed_at: number;
  described: number;
  topics_n: number;
  homepage: number;
  tool: string | null;
  signal: string | null;
  sieve: string;
}

/** The shapes a search-level claim can take, in the order one is chosen when a repo shows more than one. */
export const SIGNALS = ["vibe-coded", "built-with", "ai-generated", "topic"] as const;
export type Signal = (typeof SIGNALS)[number];

/**
 * Which shape of claim the search saw. Derived from the same labels the trough prints on a listing
 * (lib/virtual trawlSignals), so the two can never disagree about what counts as a signal.
 */
export function signalOf(g: GhRepo, reg: Registry = STATIC): Signal | null {
  const labels = trawlSignals(g, reg);
  if (labels.some((l) => l.includes('"vibe coded"'))) return "vibe-coded";
  if (labels.some((l) => l.startsWith("says it was built with"))) return "built-with";
  if (labels.some((l) => l.includes('"AI-generated"'))) return "ai-generated";
  if (labels.some((l) => l.startsWith("tagged "))) return "topic";
  return null;
}

/**
 * The tool a repo credits in its topics or description, by registry key. The same reading the trough's
 * stand-in paperwork makes (lib/virtual buildVirtualMd), so a seen row and a listing credit the same tool.
 * A description credit is weaker than a README's past-tense sentence, and the method says so.
 */
export function toolNamed(g: GhRepo, reg: Registry = STATIC): string | null {
  for (const t of g.topics ?? []) {
    const key = reg.topicTool[t.toLowerCase()];
    if (key) return key;
  }
  const d = g.description ?? "";
  if (/\bclaude code\b/i.test(d)) return "claude-code";
  const built = BUILT_WITH_RE.exec(d);
  if (built) {
    const hit = reg.signals.find(([re]) => re.test(built[1]));
    if (hit) return reg.tools.find((t) => t.name === hit[1])?.key ?? null;
  }
  return null;
}

/**
 * What the trough's cheap rules would have said, in the trough's own order: 'candidate' when every rule
 * passes, otherwise the first one that stopped it. Runs the trough's actual filter rather than a copy of it,
 * so loosening a rule there changes this column from the next sighting. The denylist term is not kept.
 */
export function seenSieve(g: GhRepo, o: { deny: DenyRow[]; at: number; reg?: Registry }): string {
  const r = pickCandidates([g], { known: new Set(), deny: o.deny, at: o.at, reg: o.reg });
  if (r.picks.length) return "candidate";
  const why = r.skipped[0]?.why ?? "unknown";
  return why.startsWith("denylist") ? "denylist" : why.slice(0, 120);
}

const stamp = (iso: string | null | undefined): number => Math.floor(Date.parse(iso ?? "") / 1000) || 0;

/** One search result as a sighting. `qi` is the search's index in the run's list; `query` its bare text. */
export function seenRow(g: GhRepo, o: { at: number; qi: number; nq: number; query: string; deny: DenyRow[]; reg?: Registry }): SeenRow {
  const reg = o.reg ?? STATIC;
  return {
    full_name: g.full_name.toLowerCase(),
    repo_id: g.id,
    ground: groundOfQuery(o.qi, o.nq),
    query: o.query,
    at: o.at,
    stars: g.stargazers_count ?? 0,
    forks: g.forks_count ?? 0,
    size_kb: g.size ?? 0,
    open_issues: g.open_issues_count ?? 0,
    language: g.language || null,
    license: g.license?.spdx_id || null,
    owner_type: g.owner?.type || "User",
    created_at: stamp(g.created_at),
    pushed_at: stamp(g.pushed_at),
    described: (g.description ?? "").trim() ? 1 : 0,
    topics_n: (g.topics ?? []).length,
    homepage: (g.homepage ?? "").trim() ? 1 : 0,
    tool: toolNamed(g, reg),
    signal: signalOf(g, reg),
    sieve: seenSieve(g, { deny: o.deny, at: o.at, reg }),
  };
}

/** What a sighting records, in the words the method page uses. The table holds exactly these and the key. */
export const SEEN_FACTS = [
  "stars, forks, size and open issues",
  "language and licence, as GitHub reports them",
  "whether the owner is a person or an organisation",
  "when it was created and when it was last pushed",
  "whether it has a description and a homepage, and how many topics it carries",
  "the tool its topics or description credit, if any",
  "the shape of the claim the search saw: vibe-coded, built-with, ai-generated, or a topic",
  "what the trough's own rules said about it that day: a candidate, or the first rule that stopped it",
];
/** What a sighting deliberately does not record. */
export const SEEN_NOT = ["the description", "the README", "anything a model said", "any page, link or name on the site"];

// ---- buckets the nightly count draws the sea in ----
// Facts are stored; these are how the facts are read. A bucket can be redrawn without another sighting.

/** Star buckets for the sea. Zero gets its own bar: the line between none and one is the whole finding. */
export const SEEN_STAR_ORDER = ["no stars", "1 to 4", "5 to 9", "10 to 24", "25 to 99", "100 to 499", "500 or more"];
export function seenStarBucket(stars: number): string {
  if (stars <= 0) return "no stars";
  if (stars < 5) return "1 to 4";
  if (stars < 10) return "5 to 9";
  if (stars < 25) return "10 to 24";
  if (stars < 100) return "25 to 99";
  if (stars < 500) return "100 to 499";
  return "500 or more";
}

/** Whether the site could quote from it. GitHub reports NOASSERTION for a licence file it could not name. */
export const LICENCE_ORDER = ["permissive", "another licence", "no licence"];
export function licenceClass(spdx: string | null): string {
  if (!spdx) return "no licence";
  return PERMISSIVE.has(spdx) ? "permissive" : "another licence";
}

export const OWNER_ORDER = ["a person", "an organisation"];
export const ownerClass = (type: string | null): string => (type === "Organization" ? "an organisation" : "a person");

/**
 * How long the repo lived between its creation and its last push. "One push and gone" is the clearest stub
 * signal the search response carries: created and pushed inside the same day, and never touched again.
 */
export const LIFE_ORDER = ["one push and gone", "under a week", "a week to a month", "one to three months", "over three months"];
export function lifeBucket(createdAt: number, pushedAt: number): string {
  const d = Math.max(0, pushedAt - createdAt) / 86400;
  if (d < 1) return "one push and gone";
  if (d < 7) return "under a week";
  if (d < 30) return "a week to a month";
  if (d < 90) return "one to three months";
  return "over three months";
}

/** Repo size as GitHub reports it, in kilobytes. Under 100 KB is a scaffold or a single file. */
export const SIZE_ORDER = ["under 100 KB", "100 KB to 1 MB", "1 to 10 MB", "over 10 MB"];
export function sizeBucket(kb: number): string {
  if (kb < 100) return "under 100 KB";
  if (kb < 1024) return "100 KB to 1 MB";
  if (kb < 10240) return "1 to 10 MB";
  return "over 10 MB";
}

/** The SQL that draws the life and size buckets, kept beside the JS so the two cannot drift. */
export const LIFE_SQL = `CASE WHEN pushed_at - created_at < 86400 THEN '${LIFE_ORDER[0]}' WHEN pushed_at - created_at < 7 * 86400 THEN '${LIFE_ORDER[1]}' WHEN pushed_at - created_at < 30 * 86400 THEN '${LIFE_ORDER[2]}' WHEN pushed_at - created_at < 90 * 86400 THEN '${LIFE_ORDER[3]}' ELSE '${LIFE_ORDER[4]}' END`;
export const SIZE_SQL = `CASE WHEN size_kb < 100 THEN '${SIZE_ORDER[0]}' WHEN size_kb < 1024 THEN '${SIZE_ORDER[1]}' WHEN size_kb < 10240 THEN '${SIZE_ORDER[2]}' ELSE '${SIZE_ORDER[3]}' END`;
