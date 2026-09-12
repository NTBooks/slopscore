// The critics run: each disclosed critic reviews a few listed repos it has never seen and upvotes the ones
// that meet its rubric. No GitHub account is involved anywhere; critics are rows in users (src/lib/critics.ts).
//
// Rules kept here: one review per critic per repo ever, CRITIC_DAILY_CAP reviews per critic per UTC day,
// opted-in repos before trawled ones, never a repo owned by a site admin, and never a comment.
// Prompt-injection guard: the repo is untrusted DATA in a delimited block, the model may answer only
// {"upvote", "reason"}, and the reason is published only through criticQuip, which strips links, handles
// and markup and drops the line whole rather than print anything on the profanity list. The worst a
// hostile README can do is earn one half-weight upvote; it can never make a critic say anything in public.
//
// Who runs when is not decided here. The rota (criticForSlot) picks one critic a tick, criticBudget
// decides how many repos that critic reads, and the last hour of the UTC day suspends the rota so the
// whole box reads at once and nothing is left unspent. All of it is in src/lib/critics.ts, where it is
// tested; this file only does what it is told, and enforces the daily cap regardless.
import type { Env } from "../env";
import { adminLogins } from "../env";
import { castVote, getUser, type RepoRow, type UserRow } from "../lib/db";
import { markDirty } from "../lib/cache";
import { criticVoteRefusal } from "../lib/trust";
import { now } from "../lib/time";
import {
  CRITICS, CRITICS_MODEL_DEFAULT, CRITIC_DAILY_CAP, VERDICT_SCHEMA,
  criticBudget, criticSystemPrompt, criticUserPrompt, dayStart, parseVerdict, type Critic, type Verdict,
} from "../lib/critics";
import { setState } from "./stats";

export interface CriticsResult {
  reviewed: number;
  upvoted: number;
  by: Record<string, { reviewed: number; upvoted: number; note?: string }>;
  /** Verdicts the cast could still write: listed repos times critics, minus what is already read.
   *  The balcony's supply, and the number to watch — when it reaches zero the chat stops growing. */
  pool?: number;
  note?: string;
}

/** Create or refresh the critic rows. Ids are fixed in src/lib/critics.ts, so this is safe to run every time.
 *  The WHERE makes an unchanged cast a zero-row write: this runs every quarter-hour now, not once a night. */
export async function ensureCritics(db: D1Database): Promise<void> {
  await db.batch(
    CRITICS.map((c) =>
      db.prepare(
        `INSERT INTO users (id, login, avatar_url, gh_created_at, public_repos, followers, trust, bot, bio)
         VALUES (?, ?, ?, NULL, 0, 0, 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url, bio = excluded.bio, bot = 1
          WHERE login != excluded.login OR avatar_url IS NOT excluded.avatar_url OR bio != excluded.bio OR bot != 1`,
      ).bind(c.id, c.login, c.face, c.rubric),
    ),
  );
}

/** One short, schema-bound call. Errors are not verdicts: the repo is left for the next run. */
async function judge(env: Env, c: Critic, repo: RepoRow): Promise<Verdict | { error: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": env.SITE_URL ?? "https://slopscore.org",
        "x-title": "SlopScore critics",
      },
      // A turn every quarter-hour inside ctx.waitUntil is a worse place to hang than a nightly batch was.
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: env.CRITICS_MODEL || CRITICS_MODEL_DEFAULT,
        temperature: 0.2,
        max_tokens: 150,
        response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA } },
        messages: [
          { role: "system", content: criticSystemPrompt(c) },
          { role: "user", content: criticUserPrompt(repo) },
        ],
      }),
    });
    if (!res.ok) return { error: `openrouter ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseVerdict(j.choices?.[0]?.message?.content ?? "");
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Repos this critic has never reviewed, opted-in first, newest first. Admin-owned repos are never offered. */
async function candidates(db: D1Database, criticId: number, admins: Set<string>, limit: number): Promise<RepoRow[]> {
  const skip = [...admins];
  const clause = skip.length ? ` AND lower(r.owner) NOT IN (${skip.map(() => "?").join(",")})` : "";
  const rows = await db.prepare(
    `SELECT r.* FROM repos r
     WHERE r.status = 'listed'
       AND NOT EXISTS (SELECT 1 FROM critic_reviews cr WHERE cr.critic_id = ? AND cr.repo_id = r.id)${clause}
     ORDER BY r.source ASC, r.listed_at DESC, r.id DESC
     LIMIT ?`,
  ).bind(criticId, ...skip, limit).all<RepoRow>();
  return rows.results ?? [];
}

/**
 * One run of the critics.
 *
 * `only` names who takes the stand: the per-tick rota hands one login, the last hour of the day and a
 * mod's manual run hand none and the whole box reads. How many each reads is criticBudget's decision,
 * not this function's — `n` only lets a mod hold a manual run down.
 */
export async function runCritics(env: Env, opts: { n?: number; dry?: boolean; only?: string[] } = {}): Promise<CriticsResult> {
  const out: CriticsResult = { reviewed: 0, upvoted: 0, by: {} };
  const db = env.DB;
  // Identities first, so /about and /u/<critic> are honest pages even before a model key is set.
  await ensureCritics(db);
  if (!env.OPENROUTER_API_KEY) return { ...out, note: "no OPENROUTER_API_KEY; critics need a model to read with" };
  const admins = adminLogins(env);
  const perRun = opts.n ? Math.min(Math.max(1, Math.floor(Number(opts.n))), CRITIC_DAILY_CAP) : CRITIC_DAILY_CAP;
  const since = dayStart(now());
  const roster = opts.only?.length ? CRITICS.filter((c) => opts.only!.includes(c.login)) : CRITICS;
  let wrote = false;

  // What the cast has left to read at all. A critic never reads the same repo twice, so this is the
  // ceiling on the whole feature: when it hits zero the balcony has nothing new to say at any cadence.
  out.pool = (await db.prepare(
    "SELECT (SELECT count(*) FROM repos WHERE status = 'listed') * ? - (SELECT count(*) FROM critic_reviews) AS n",
  ).bind(CRITICS.length).first<{ n: number }>())?.n ?? 0;

  for (const c of roster) {
    const mine = { reviewed: 0, upvoted: 0 } as { reviewed: number; upvoted: number; note?: string };
    out.by[c.login] = mine;
    const row = await getUser(db, c.id);
    if (!row) { mine.note = "no critic row"; continue; }
    const done = (await db.prepare("SELECT count(*) AS n FROM critic_reviews WHERE critic_id = ? AND created_at >= ?").bind(c.id, since).first<{ n: number }>())?.n ?? 0;
    const allowed = criticBudget(done, now());
    const budget = Math.min(perRun, allowed);
    if (budget <= 0) {
      mine.note = done >= CRITIC_DAILY_CAP ? `today's ${CRITIC_DAILY_CAP} are done` : `paced: ${done} read so far today`;
      continue;
    }

    for (const repo of await candidates(db, c.id, admins, budget)) {
      const v = await judge(env, c, repo);
      if ("error" in v) { mine.note = v.error; break; }  // a broken key or a rate limit stops this critic, not the run
      mine.reviewed++;
      out.reviewed++;
      if (opts.dry) continue;
      await db.prepare("INSERT OR IGNORE INTO critic_reviews (critic_id, repo_id, upvote, reason) VALUES (?,?,?,?)")
        .bind(c.id, repo.id, v.upvote ? 1 : 0, v.reason).run();
      // Any verdict is news, not just the ones that voted: most of them are passes, and the rail's chat
      // quotes those too. Marking dirty only on a vote left the balcony hours stale for no reason.
      wrote = true;
      if (!v.upvote) continue;
      if (criticVoteRefusal(1, repo.owner, admins)) continue;  // belt and braces: the same rule the routes enforce
      await castVote(db, row as UserRow, repo, 1, null, true);
      mine.upvoted++;
      out.upvoted++;
    }
  }

  if (wrote) await markDirty(db);
  await setState(db, "critics:last_run", String(now()));
  return out;
}
