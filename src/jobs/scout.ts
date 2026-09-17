// The scout: turns the tool names the trawl did not recognise into a short list a moderator can act on.
//
// The trawl writes a row to tool_sightings every time a candidate names a tool the registry does not know
// (lib/tools.ts extractSightings). On its own that is noise: one repo saying "built with Kiro" is a typo or a
// joke. Three repos saying it inside two months is a tool. This job counts, once a night, and writes the
// counts to tool_candidates, where /mod shows them with the repos that said it. It never decides anything:
// a candidate's status is a moderator's, and this job only ever refreshes the numbers beside it, so a term a
// moderator dismissed stays dismissed while its count keeps being true.
//
// Three sources, one shape. Sightings from the trawl (the rejects are where new tools live, which is the whole
// reason the trawl records them); the built-with-* topics on listed repos; and built_with values an opted-in
// owner declared that the vocabulary did not recognise, which is the strongest signal of all, because a person
// typed it about their own work.
//
// One mail a day at most, only when a term newly crosses the line, the way the lookout does it. Fails open:
// no MAIL binding, no destination, or a send that throws leaves the candidates written and the site running.
import type { Env } from "../env";
import { markDirty } from "../lib/cache";
import { encodeHeader } from "../lib/mail";
import { isoDate, now } from "../lib/time";
import { STOPLIST, allTools, knownTerms, loadToolRows, normalizeTerm } from "../lib/tools";

/** Distinct repos a term needs before it is worth a moderator's minute. */
export const SCOUT_MIN = 3;
/** How far back sightings count. Two months: long enough for a new tool to show up three times, short enough that a fad ages out. */
export const SIGHTING_DAYS = 60;
/** Sightings older than this are deleted. A month past the counting window, so a term can fall out and come back. */
export const SIGHTING_KEEP_DAYS = 90;

export interface SightingRow { term: string; kind: string; full_name: string; at: number }
export interface Candidate { term: string; n: number; kinds: string[]; samples: string[]; first_seen: number; last_seen: number }

/**
 * Pure: sightings from any source into one row per term. Known tools and generic words drop out here as well
 * as at capture time, because the registry may have grown since the row was written. `keep` is the set of terms
 * that already have a candidate row: their counts are refreshed however small they have become.
 */
export function shapeCandidates(rows: SightingRow[], known: Set<string>, keep: Set<string> = new Set(), min = SCOUT_MIN): Candidate[] {
  const by = new Map<string, { repos: Set<string>; kinds: Set<string>; first: number; last: number }>();
  for (const r of rows) {
    const term = normalizeTerm(r.term);
    if (!term || known.has(term) || STOPLIST.has(term)) continue;
    const c = by.get(term) ?? { repos: new Set<string>(), kinds: new Set<string>(), first: r.at, last: r.at };
    c.repos.add(r.full_name.toLowerCase());
    c.kinds.add(r.kind);
    c.first = Math.min(c.first, r.at);
    c.last = Math.max(c.last, r.at);
    by.set(term, c);
  }
  return [...by]
    .filter(([term, c]) => c.repos.size >= min || keep.has(term))
    .map(([term, c]) => ({ term, n: c.repos.size, kinds: [...c.kinds].sort(), samples: [...c.repos].sort().slice(0, 3), first_seen: c.first, last_seen: c.last }))
    .sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));
}

/** A listed repo's built-with-* topic, as the term it names. Null for any other topic. */
export const topicTerm = (topic: string): string | null => /^(?:built|made|coded|generated|vibe-coded)-with-(.+)$/.exec(topic.toLowerCase())?.[1] ?? null;

export interface ScoutResult { seen: number; open: number; newly: string[]; mailed: boolean; note?: string }

export async function scout(env: Env, at = now()): Promise<ScoutResult> {
  const db = env.DB;
  const known = knownTerms(allTools(await loadToolRows(db)));

  // 1. Gather. Three queries, none of them a model call.
  const [sightings, topics, declared, existing] = await Promise.all([
    db.prepare("SELECT term, kind, full_name, at FROM tool_sightings WHERE at >= ?").bind(at - SIGHTING_DAYS * 86400).all<SightingRow>().then((r) => r.results ?? []),
    db.prepare(
      `SELECT rt.value AS term, 'topic' AS kind, lower(r.full_name) AS full_name, coalesce(r.listed_at, r.first_seen) AS at
         FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id
        WHERE rt.facet = 'topic' AND rt.value LIKE 'built-with-%' AND r.status = 'listed'`,
    ).all<SightingRow>().then((r) => (r.results ?? []).map((x) => ({ ...x, term: topicTerm(x.term) ?? "" })).filter((x) => x.term)),
    db.prepare(
      `SELECT rt.value AS term, 'declared' AS kind, lower(r.full_name) AS full_name, coalesce(r.listed_at, r.first_seen) AS at
         FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id
        WHERE rt.facet = 'built_with' AND rt.recognized = 0 AND rt.source = 'declared' AND r.status IN ('listed', 'discovered', 'quarantined')`,
    ).all<SightingRow>().then((r) => r.results ?? []),
    db.prepare("SELECT term, status FROM tool_candidates").all<{ term: string; status: string }>().then((r) => r.results ?? []),
  ]);
  const rows = [...sightings, ...topics, ...declared];
  const keep = new Set(existing.map((e) => e.term));
  const candidates = shapeCandidates(rows, known, keep);

  // 2. Write the counts. Status is never in this statement: it belongs to whoever decided it.
  for (let i = 0; i < candidates.length; i += 100) {
    await db.batch(candidates.slice(i, i + 100).map((c) => db.prepare(
      `INSERT INTO tool_candidates (term, n, kinds, samples, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(term) DO UPDATE SET n = excluded.n, kinds = excluded.kinds, samples = excluded.samples,
         first_seen = min(first_seen, excluded.first_seen), last_seen = excluded.last_seen`,
    ).bind(c.term, c.n, JSON.stringify(c.kinds), JSON.stringify(c.samples), c.first_seen, c.last_seen)));
  }
  await db.prepare("DELETE FROM tool_sightings WHERE at < ?").bind(at - SIGHTING_KEEP_DAYS * 86400).run();

  const newly = candidates.filter((c) => !keep.has(c.term)).map((c) => c.term);
  const open = candidates.filter((c) => (existing.find((e) => e.term === c.term)?.status ?? "open") === "open").length;
  if (candidates.length) await markDirty(db);
  if (!newly.length) return { seen: rows.length, open, newly, mailed: false };

  // 3. The doorbell, once a day. The claim is the throttle: an atomic insert, so two runs cannot both win.
  const to = env.CONTACT_NOTIFY;
  if (!env.MAIL || !to) return { seen: rows.length, open, newly, mailed: false, note: "no MAIL binding or CONTACT_NOTIFY; the candidates are on /mod#scout" };
  const claimed = await db.prepare("INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(`scout:alerted:${isoDate(at)}`, String(at)).run().catch(() => null);
  if (!claimed || !claimed.meta.changes) return { seen: rows.length, open, newly, mailed: false, note: "already mailed today" };
  const sent = await send(env, to, candidates.filter((c) => newly.includes(c.term))).then(() => true).catch(() => false);
  return { seen: rows.length, open, newly, mailed: sent, note: sent ? undefined : "send failed; /mod#scout still shows them" };
}

/** The mail: what was found, who said it, and where to decide. A finished note, not a notification. */
export function scoutMail(site: string, found: Candidate[]): { subject: string; text: string } {
  const lines = [
    `The scout has ${found.length === 1 ? "a tool name" : `${found.length} tool names`} the registry does not know, each said by ${SCOUT_MIN} or more repos in the last ${SIGHTING_DAYS} days.`,
    "",
    ...found.flatMap((c) => [
      `  ${c.term}`,
      `    repos:    ${c.n}`,
      `    seen as:  ${c.kinds.join(", ")}`,
      `    e.g.      ${c.samples.map((s) => `https://github.com/${s}`).join("  ")}`,
      "",
    ]),
    `Approve, merge into a tool you already know, or dismiss: ${site}/mod#scout`,
    "",
    "Approving takes effect at once: the trawl searches for it from the next hour, it is credited and counted",
    "on every chart, and it is listed with today's date on /method. Nothing here was decided by a model.",
    "One mail a day at most, however many names turn up.",
  ];
  return { subject: `[SlopScore] The scout found ${found.length === 1 ? `a tool: ${found[0].term}` : `${found.length} tools: ${found.map((c) => c.term).join(", ")}`}`, text: lines.join("\n") };
}

async function send(env: Env, to: string, found: Candidate[]): Promise<void> {
  const from = env.CONTACT_FROM ?? "schnitzel@slopscore.org";
  const { subject, text } = scoutMail(env.SITE_URL ?? "https://slopscore.org", found);
  const raw = [
    `From: Schnitzel <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <scout-${isoDate(now())}-${Date.now()}@slopscore.org>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAIL!.send(new EmailMessage(from, to, raw));
}
