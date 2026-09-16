// The tripwire: notice requests shaped like an attack, count them, shut the door for a day, and send one
// email so somebody can decide whether to turn Cloudflare's Bot Fight Mode on.
//
// What this is NOT: a defence. The injection defences are elsewhere and they are the ones that matter --
// every query is parameterised (lib/db.ts), every model call is schema-bound with the stranger's text in a
// delimited data block (lib/judge.ts, lib/critics.ts), and every page carries a hash-based CSP (lib/csp.ts).
// This module exists to answer "is anybody actually trying?", because that question decides whether it is
// worth paying for bot management, and it cannot be answered from the access log alone.
//
// Two severities, because they are two different questions. See migrations/0013_tripwire.sql.
//
// Everything here fails open. A tripwire that can 500 a page is a denial of service with extra steps, so
// the call site wraps it in a try/catch and a request that trips a detector is still served normally
// unless it earns a block.
import type { Env } from "../env";
import { encodeHeader } from "./mail";
import { isoDate, now } from "./time";
import { flagOn } from "./flags";

export const TRIP_KINDS = ["sql-probe", "prompt-probe", "traversal", "oversize", "bad-page", "scanner"] as const;
export type TripKind = (typeof TRIP_KINDS)[number];

/**
 * Only these close the door. The rest are counted and reported, never blocked.
 *
 * `prompt-probe` is deliberately not here. This site lists AI tooling, and "ignore all previous
 * instructions" typed into its search box is at least as likely to be somebody looking for a
 * prompt-injection test suite as somebody running one. It is still counted and still raises the email;
 * it just never costs a whole NAT a day of access. SQL and traversal shapes carry their own punctuation
 * and are nobody's search.
 */
const BLOCKABLE = new Set<TripKind>(["sql-probe", "traversal"]);
export const blockable = (k: TripKind): boolean => BLOCKABLE.has(k);

/** Only these raise the email. `scanner` and `bad-page` are the weather, not an event. */
const TARGETED = new Set<TripKind>(["sql-probe", "prompt-probe", "traversal", "oversize"]);

export const severityOf = (k: TripKind): "targeted" | "noise" => (TARGETED.has(k) ? "targeted" : "noise");

export const BLOCK_SECONDS = 24 * 3600;

/**
 * Targeted hits from one source in a UTC day before the door shuts on it. One is a curious person or a
 * shared address's one bad tenant; three in a day is a tool. A probe run trips this on its first
 * screenful, so the attacker loses nothing an earlier block would have cost them.
 */
export const BLOCK_AFTER = 3;

/**
 * Paths a shut-out address may still reach. The refusal tells people to say so at /contact, which means
 * /contact has to answer them; a block that also blocks the appeal is a block with no appeal.
 */
export const DOOR_EXEMPT = ["/contact"] as const;
export const doorExempt = (pathname: string): boolean =>
  DOOR_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Whether this hit shuts the door. Pure, so the policy is the tested part: the IO around it only supplies
 * the count. `targetedToday` includes the hit being decided.
 */
export function shouldShut(o: { kind: TripKind; exempt: boolean; hash: string | null; targetedToday: number; blocking: boolean }): boolean {
  return o.blocking && !o.exempt && o.hash != null && BLOCKABLE.has(o.kind) && o.targetedToday >= BLOCK_AFTER;
}

/**
 * Shapes that are nobody's accident.
 *
 * Deliberately narrow. This site is a directory of software, so people search it for words like "select",
 * "union" and "drop" in good faith, and a false positive now costs somebody a day of access. Every pattern
 * here wants the punctuation of a real injection attempt, not just the keyword.
 */
const SQL = [
  /\bunion\s+(all\s+)?select\b/i,
  /['")]\s*(or|and)\s+['"]?[\w.]+['"]?\s*(=|<>|!=|like)\s*['"]?[\w.]+/i,
  // A terminator is wanted rather than end-of-string: "3 or 4 = 7" is somebody doing sums, and under a
  // 24-hour block a shape that loose is not worth the one real probe it would add. A quoted tautology is
  // already covered by the line above.
  /\b(or|and)\s+\d+\s*=\s*\d+\s*(--|#|\/\*|;|\))/i,
  /;\s*(drop|delete|truncate|alter|insert|update)\s+(table|from|into)\b/i,
  /\b(sqlite_master|information_schema\.|pg_sleep\s*\(|benchmark\s*\(|load_file\s*\(|extractvalue\s*\()/i,
];

/**
 * Prompt injection aimed at the models this site runs: the trawl judge, the critics, the comment guard.
 * `<repo>` is our own delimiter, so seeing it in a query string means somebody has read judge.ts and is
 * trying to end the data block early. That is the one shape here that is unambiguous on its own.
 */
const PROMPT = [
  /<\/?repo>/i,
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)/i,
  /\b(system|developer)\s*(prompt|message|instructions?)\s*[:=]/i,
  /\bnew\s+instructions?\s*[:=]/i,
  /\b(reveal|print|repeat|output)\s+(your|the)\s+(system\s+)?(prompt|instructions)\b/i,
];

const TRAVERSAL = [/\.\.\//, /\.\.%2f/i, /%2e%2e[/%]/i, /\/etc\/passwd\b/i, /proc\/self\/environ/i];

/** Background radiation: somebody else's CMS, scanned by a bot that has never heard of this site. */
const SCANNER = [
  /(^|\/)\.env(\.|$)/i, /(^|\/)\.git\//i, /(^|\/)\.aws\//i, /(^|\/)\.ssh\//i,
  /\/wp-(admin|login|content|includes)\b/i, /\/xmlrpc\.php$/i, /\/phpmyadmin\b/i,
  /\/vendor\/phpunit\b/i, /\.(php|asp|aspx|jsp|cgi)$/i, /\/actuator\/|\/solr\/|\/cgi-bin\//i,
];

const QUERY_CAP = 2000;
const VALUE_CAP = 4000;

export interface Trip { kind: TripKind; sample: string }

/**
 * Read one request's path and query. Bodies are left alone on purpose: reading one here would consume the
 * stream the route needs, and the submitted text that matters already passes the comment guard and the
 * moderation hold. First match wins, worst first.
 */
export function classify(url: URL): Trip | null {
  const path = url.pathname;
  const qs = url.search.slice(1);
  const hay = `${path}?${qs}`;
  let decoded = hay;
  try { decoded = decodeURIComponent(hay); } catch { /* malformed escapes: judge the raw form */ }
  const both = [hay, decoded];

  if (TRAVERSAL.some((re) => both.some((h) => re.test(h)))) return { kind: "traversal", sample: redact(hay) };
  if (SQL.some((re) => both.some((h) => re.test(h)))) return { kind: "sql-probe", sample: redact(hay) };
  if (PROMPT.some((re) => both.some((h) => re.test(h)))) return { kind: "prompt-probe", sample: redact(hay) };
  if (SCANNER.some((re) => re.test(path))) return { kind: "scanner", sample: redact(path) };
  if (qs.length > QUERY_CAP) return { kind: "oversize", sample: `${qs.length} bytes of query on ${redact(path)}` };
  for (const [, v] of url.searchParams) {
    if (v.length > VALUE_CAP) return { kind: "oversize", sample: `${v.length}-byte param on ${redact(path)}` };
  }

  // The overflow that used to be a 500: ?page=abc bound NaN straight into LIMIT/OFFSET. parsePage() in
  // lib/db.ts clamps it now, and this records that somebody asked.
  const page = url.searchParams.get("page");
  if (page !== null && !/^\d{1,9}$/.test(page)) return { kind: "bad-page", sample: `page=${redact(page).slice(0, 60)}` };
  return null;
}

/** One short, printable example for a human. No control characters, nothing long enough to hide a payload. */
function redact(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

// ---- the door ----

let doorway = new Set<string>();
let doorwayAt = 0;
const DOOR_TTL = 60;

/** Cheap on the hot path: one query a minute per isolate, then a set lookup. */
export async function isShut(db: D1Database, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  const t = now();
  if (t - doorwayAt > DOOR_TTL) {
    const r = await db.prepare("SELECT ip_hash FROM tripwire_blocks WHERE until > ?").bind(t).all<{ ip_hash: string }>();
    doorway = new Set((r.results ?? []).map((x) => x.ip_hash));
    doorwayAt = t;
  }
  return doorway.has(hash);
}

/** Shut the door for BLOCK_SECONDS, and start refusing in this isolate immediately. */
async function shut(db: D1Database, hash: string, kind: TripKind): Promise<void> {
  const t = now();
  doorway.add(hash);
  await db.prepare(
    `INSERT INTO tripwire_blocks (ip_hash, until, kind, hits, at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(ip_hash) DO UPDATE SET until = ?, kind = excluded.kind, hits = tripwire_blocks.hits + 1`,
  ).bind(hash, t + BLOCK_SECONDS, kind, t, t + BLOCK_SECONDS).run();
}

// ---- recording ----

export interface RecordResult { kind: TripKind; blocked: boolean }

/**
 * Count a trip and decide the consequence. Safe to call from waitUntil: it never touches the response.
 *
 * `exempt` means a verified search crawler or a logged-in admin. Those are counted and never locked out:
 * Googlebot following a mangled link must not be able to take this site out of the index.
 */
export async function record(env: Env, trip: Trip, hash: string | null, exempt: boolean): Promise<RecordResult> {
  const t = now();
  const day = isoDate(t);
  const sev = severityOf(trip.kind);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tripwire (day, kind, severity, n, first_at, last_at, sample) VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(day, kind) DO UPDATE SET n = tripwire.n + 1, last_at = excluded.last_at, sample = excluded.sample`,
    ).bind(day, trip.kind, sev, t, t, trip.sample),
    ...(hash
      ? [env.DB.prepare(
        `INSERT INTO tripwire_ips (day, ip_hash, n, targeted, last_at) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(day, ip_hash) DO UPDATE SET n = tripwire_ips.n + 1, targeted = tripwire_ips.targeted + excluded.targeted, last_at = excluded.last_at`,
      ).bind(day, hash, sev === "targeted" ? 1 : 0, t)]
      : []),
  ]);

  // The count is only fetched when it could matter: a blockable kind from a source that can be blocked.
  const candidate = hash != null && !exempt && BLOCKABLE.has(trip.kind) && flagOn("tripblock");
  const targetedToday = candidate
    ? (await env.DB.prepare("SELECT targeted FROM tripwire_ips WHERE day = ? AND ip_hash = ?").bind(day, hash).first<{ targeted: number }>())?.targeted ?? 1
    : 0;
  const blocked = shouldShut({ kind: trip.kind, exempt, hash, targetedToday, blocking: flagOn("tripblock") });
  if (blocked) await shut(env.DB, hash!, trip.kind);
  if (sev === "targeted") await maybeAlert(env, day, trip, blocked);
  return { kind: trip.kind, blocked };
}

// ---- the email ----

/**
 * At most one email per UTC day, whatever arrives. An alert an attacker can send on demand is a mail bomb
 * pointed at its owner, so the throttle is not a nicety. The claim on the day is an atomic insert, so two
 * simultaneous probes cannot both win it.
 */
async function maybeAlert(env: Env, day: string, trip: Trip, blocked: boolean): Promise<void> {
  const to = env.TRIPWIRE_NOTIFY ?? env.CONTACT_NOTIFY;
  if (!env.MAIL || !to) return;
  const at = Number(env.TRIPWIRE_ALERT_AT ?? 1) || 1;
  const totals = await counts(env.DB, day);
  if (totals.targeted < at) return;
  const claimed = await env.DB.prepare(
    "INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  ).bind(`tripwire:alerted:${day}`, String(now())).run();
  if (!claimed.meta.changes) return;   // another request today already sent it
  await send(env, to, day, trip, blocked, totals);
}

export interface Counts {
  targeted: number;
  noise: number;
  ips: number;
  worst: number;
  byKind: { kind: string; severity: string; n: number; sample: string | null; last_at: number }[];
}

export async function counts(db: D1Database, day: string): Promise<Counts> {
  const [rows, ips] = await Promise.all([
    db.prepare("SELECT kind, severity, n, sample, last_at FROM tripwire WHERE day = ? ORDER BY n DESC").bind(day)
      .all<Counts["byKind"][number]>().then((r) => r.results ?? []),
    db.prepare("SELECT count(*) AS ips, COALESCE(max(n), 0) AS worst FROM tripwire_ips WHERE day = ?").bind(day)
      .first<{ ips: number; worst: number }>(),
  ]);
  return {
    targeted: rows.filter((r) => r.severity === "targeted").reduce((a, r) => a + r.n, 0),
    noise: rows.filter((r) => r.severity !== "targeted").reduce((a, r) => a + r.n, 0),
    ips: ips?.ips ?? 0,
    worst: ips?.worst ?? 0,
    byKind: rows,
  };
}

async function send(env: Env, to: string, day: string, trip: Trip, blocked: boolean, t: Counts): Promise<void> {
  const from = env.CONTACT_FROM ?? "schnitzel@slopscore.org";
  const site = env.SITE_URL ?? "https://slopscore.org";
  const lines = [
    `Something is probing SlopScore. The first targeted hit today was ${trip.kind}.`,
    "",
    `  what:    ${trip.kind}`,
    `  sample:  ${trip.sample}`,
    `  blocked: ${blocked ? "yes, that source is shut out for 24 hours" : `no (under ${BLOCK_AFTER} targeted hits from it today, a kind that never blocks, tripblock off, or an exempt source)`}`,
    "",
    `Today (${day}) so far:`,
    `  targeted attempts: ${t.targeted}`,
    `  background noise:  ${t.noise}   (scanners and mangled links: normal, ignore)`,
    `  distinct sources:  ${t.ips}, busiest one ${t.worst} hits`,
    "",
    ...t.byKind.map((k) => `  ${k.kind.padEnd(14)} ${String(k.n).padStart(6)}   ${k.sample ?? ""}`),
    "",
    "If the source count is high, or this keeps arriving, turn on Bot Fight Mode:",
    "  Cloudflare dashboard -> slopscore.org -> Security -> Bots -> Bot Fight Mode.",
    "",
    `Live numbers and the block list: ${site}/mod`,
    "",
    "One email a day at most, however much arrives. None of this is a breach: every query is",
    "parameterised and every model call is schema-bound. This is the doorbell, not the lock.",
    "Turn it off with -tripwire in MOD_FLAGS; keep the counters but stop blocking with -tripblock.",
  ];
  const subject = `[SlopScore] ${t.targeted} probe${t.targeted === 1 ? "" : "s"} today (${trip.kind})`;
  const raw = [
    `From: Schnitzel <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <trip-${day}-${Date.now()}@slopscore.org>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    lines.join("\n"),
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAIL!.send(new EmailMessage(from, to, raw));
}

/** Daily housekeeping: expired blocks go, counters keep a fortnight. */
export async function sweepTripwire(db: D1Database): Promise<void> {
  const cutoff = isoDate(now() - 14 * 86400);
  await db.batch([
    db.prepare("DELETE FROM tripwire_blocks WHERE until <= ?").bind(now()),
    db.prepare("DELETE FROM tripwire WHERE day < ?").bind(cutoff),
    db.prepare("DELETE FROM tripwire_ips WHERE day < ?").bind(cutoff),
  ]);
}
