// The doorbell: tell the owner when somebody walks in.
//
// Why it exists. A stranger opted in, launched, won Slop of the Day, heard nothing back for three days, and took
// it all down again, and the first anyone here knew of it was a removed page. Every one of those steps was in the
// moderation log; nobody reads a log. So every five minutes this reads two cursors and mails what is new:
//
//   - repos that opted in (a slopscore.md, found by a ping or the sweep), whatever the scan made of them: a
//     rejection is the one most worth hearing about, since that person is stuck on their paperwork;
//   - from the mod log, what owners did (submit, remove, restore), a trawled listing being adopted by its
//     owner, and takedown requests.
//
// The site's own admins are left out: you do not need a mail about the button you just pressed.
//
// One mail per tick at most, however many arrivals, and at most MAX_PER_DAY a UTC day; past that the cursors
// hold and the rest arrives in the first mail tomorrow. Nothing is ever mailed twice: the cursors move before
// the send, and move back if the send throws, so a failed mail is retried on the next tick rather than lost.
// The first run arms the cursors at "now" and mails nothing, so switching it on never replays the archive.
import type { Env } from "../env";
import { adminLogins } from "../env";
import { encodeHeader } from "../lib/mail";
import { isoDate, isoDateTime, now } from "../lib/time";
import { getState, setState } from "./stats";

/** Mails a UTC day, at most. A burst beyond it waits for tomorrow's first mail rather than being dropped. */
export const MAX_PER_DAY = 24;
/** Rings listed in one mail; the rest are counted and left to /log. */
const MAX_LINES = 40;
/** The mod log actions worth a doorbell. Everything else there is the site talking to itself. */
export const RING_ACTIONS = ["submit", "remove", "restore", "adopted", "takedown", "takedown-queued"] as const;

const LOG_KEY = "doorbell:log";     // last mod_log id read
const REPO_KEY = "doorbell:repo";   // last repos.first_seen read

export interface Ring { kind: "opt-in" | (typeof RING_ACTIONS)[number]; repo: string; who: string | null; at: number; note: string | null }
export interface DoorbellResult { rang: number; mailed: boolean; note?: string }

interface OptInRow { full_name: string; owner: string; status: string; tier: string; tagline: string | null; reject_reason: string | null; queue_reason: string | null; first_seen: number }
interface LogRow { id: number; actor_login: string; action: string; target_label: string | null; note: string | null; created_at: number }

export async function doorbell(env: Env): Promise<DoorbellResult> {
  const db = env.DB;
  const t = now();
  const [logAt, repoAt] = await Promise.all([getState(db, LOG_KEY), getState(db, REPO_KEY)]);
  if (logAt == null || repoAt == null) {
    const top = await db.prepare("SELECT (SELECT coalesce(max(id), 0) FROM mod_log) AS log").first<{ log: number }>();
    await Promise.all([setState(db, LOG_KEY, String(top?.log ?? 0)), setState(db, REPO_KEY, String(t - 1))]);
    return { rang: 0, mailed: false, note: "armed: rings from now on" };
  }

  // Strictly before this second: a repo inserted later in the same second still has a first_seen above the cursor.
  const optIns = await db.prepare(
    `SELECT full_name, owner, status, tier, tagline, reject_reason, queue_reason, first_seen FROM repos
      WHERE source = 'marker' AND first_seen > ? AND first_seen < ? ORDER BY first_seen ASC LIMIT 200`,
  ).bind(Number(repoAt), t).all<OptInRow>().then((r) => r.results ?? []);
  // The log cursor moves past everything up to the top read here, rings or not, so a quiet tick never rereads
  // the same rows; the top is read first, so a row written mid-tick is above it and waits for the next one.
  const top = await db.prepare("SELECT coalesce(max(id), 0) AS id FROM mod_log").first<{ id: number }>().then((r) => r?.id ?? Number(logAt));
  const logs = await db.prepare(
    `SELECT id, actor_login, action, target_label, note, created_at FROM mod_log
      WHERE id > ? AND id <= ? AND action IN (${RING_ACTIONS.map(() => "?").join(",")}) ORDER BY id ASC LIMIT 200`,
  ).bind(Number(logAt), top, ...RING_ACTIONS).all<LogRow>().then((r) => r.results ?? []);
  const nextLog = logs.length === 200 ? logs[logs.length - 1].id : Math.max(Number(logAt), top);
  const nextRepo = optIns.length ? optIns[optIns.length - 1].first_seen : Math.max(Number(repoAt), t - 1);

  const rings = collect(optIns, logs, adminLogins(env));
  if (!rings.length) {
    await Promise.all([setState(db, LOG_KEY, String(nextLog)), setState(db, REPO_KEY, String(nextRepo))]);
    return { rang: 0, mailed: false };
  }

  const to = env.CONTACT_NOTIFY;
  if (!env.MAIL || !to) {
    await Promise.all([setState(db, LOG_KEY, String(nextLog)), setState(db, REPO_KEY, String(nextRepo))]);
    return { rang: rings.length, mailed: false, note: "no MAIL binding or CONTACT_NOTIFY; the rings are on /log" };
  }
  const dayKey = `doorbell:mails:${isoDate(t)}`;
  const sentToday = Number((await getState(db, dayKey)) ?? 0);
  if (sentToday >= MAX_PER_DAY) return { rang: rings.length, mailed: false, note: `${MAX_PER_DAY} mails today already; holding for tomorrow` };

  // Claim before sending, so an overlapping tick cannot mail the same rings; give it back if the send fails.
  const claim = await db.prepare("UPDATE crawl_state SET value = ? WHERE key = ? AND value = ?").bind(String(nextLog), LOG_KEY, logAt).run();
  if (!claim.meta.changes) return { rang: rings.length, mailed: false, note: "another tick has these" };
  await setState(db, REPO_KEY, String(nextRepo));
  try {
    await send(env, to, rings);
  } catch (e) {
    await Promise.all([setState(db, LOG_KEY, logAt), setState(db, REPO_KEY, repoAt)]);
    throw new Error(`doorbell send failed, will retry: ${(e as Error).message}`);
  }
  await setState(db, dayKey, String(sentToday + 1));
  return { rang: rings.length, mailed: true };
}

/** Rows to rings, oldest first, the admins' own doings left out. */
export function collect(optIns: OptInRow[], logs: LogRow[], admins: Set<string>): Ring[] {
  const ownerOf = (full: string | null) => (full ?? "").split("/")[0].toLowerCase();
  const rings: Ring[] = [];
  for (const r of optIns) {
    if (admins.has(r.owner.toLowerCase())) continue;
    const why = r.reject_reason ?? (r.status === "quarantined" ? r.queue_reason : null);
    rings.push({ kind: "opt-in", repo: r.full_name, who: r.owner, at: r.first_seen, note: [`${r.status} · ${r.tier}`, why ? `why: ${why}` : null, r.tagline].filter(Boolean).join(" — ") });
  }
  for (const l of logs) {
    if (admins.has(l.actor_login.toLowerCase())) continue;
    if (l.actor_login === "system" && admins.has(ownerOf(l.target_label))) continue;
    rings.push({ kind: l.action as Ring["kind"], repo: l.target_label ?? "?", who: l.actor_login === "system" ? null : l.actor_login, at: l.created_at, note: l.note });
  }
  return rings.sort((a, b) => a.at - b.at);
}

const KIND_LABEL: Record<Ring["kind"], string> = {
  "opt-in": "OPT-IN", submit: "SUBMIT", remove: "REMOVED", restore: "RESTORED", adopted: "ADOPTED", takedown: "TAKEDOWN", "takedown-queued": "TAKEDOWN?",
};
const KIND_SAYS: Record<Ring["kind"], string> = {
  "opt-in": "committed a slopscore.md",
  submit: "the owner pressed Submit: a launch, in the running for Slop of the Day",
  remove: "the owner took it down",
  restore: "the owner put it back up",
  adopted: "the owner committed their own slopscore.md over the Cap'm's paperwork",
  takedown: "a takedown request hid a trawled listing",
  "takedown-queued": "a takedown request is waiting for a human",
};

export function subjectFor(rings: Ring[]): string {
  if (rings.length === 1) return `[SlopScore] ${KIND_LABEL[rings[0].kind].toLowerCase()}: ${rings[0].repo}`;
  const counts = new Map<string, number>();
  for (const r of rings) counts.set(KIND_LABEL[r.kind].toLowerCase(), (counts.get(KIND_LABEL[r.kind].toLowerCase()) ?? 0) + 1);
  return `[SlopScore] ${rings.length} at the door: ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ")}`;
}

export function bodyFor(rings: Ring[], site: string): string {
  const shown = rings.slice(0, MAX_LINES);
  return [
    `${rings.length === 1 ? "Somebody is" : `${rings.length} somebodies are`} at the door.`,
    "",
    ...shown.flatMap((r) => [
      `${KIND_LABEL[r.kind].padEnd(10)} ${r.repo}${r.who ? `  (${r.who})` : ""}  ${isoDateTime(r.at)}`,
      `           ${KIND_SAYS[r.kind]}`,
      ...(r.note ? [`           ${r.note.replace(/\s+/g, " ").slice(0, 240)}`] : []),
      `           ${site}/r/${r.repo}`,
      "",
    ]),
    ...(rings.length > shown.length ? [`...and ${rings.length - shown.length} more on ${site}/log`, ""] : []),
    "A launch nobody answers is a launch that gets taken down. A vote and a line from you inside a day",
    "is the whole difference.",
    "",
    `Everything here is on ${site}/log too. One mail per five-minute tick at most, ${MAX_PER_DAY} a day.`,
  ].join("\n");
}

async function send(env: Env, to: string, rings: Ring[]): Promise<void> {
  const from = env.CONTACT_FROM ?? "schnitzel@slopscore.org";
  const site = env.SITE_URL ?? "https://slopscore.org";
  const raw = [
    `From: Schnitzel <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subjectFor(rings))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <doorbell-${Date.now()}@slopscore.org>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    bodyFor(rings, site),
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAIL!.send(new EmailMessage(from, to, raw));
}
