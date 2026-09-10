// Anonymous "crowd" votes: visible, capped by visitors, never ranking.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "./session";
import { viewsToday } from "./views";
import { now } from "./time";

const COOKIE = "anon";
const YEAR = 365 * 86400;

/** Returns a stable anonymous id for this browser, setting the signed cookie if needed. Never for logged-in users. */
export async function anonId(c: Context, secret: string): Promise<string> {
  const existing = getCookie(c, COOKIE);
  if (existing) {
    const p = await verify(existing, secret);
    if (p && typeof (p as unknown as { aid?: string }).aid === "string") return (p as unknown as { aid: string }).aid;
  }
  const aid = crypto.randomUUID();
  const token = await sign({ uid: 0, exp: now() + YEAR, aid } as never, secret);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: YEAR, secure: new URL(c.req.url).protocol === "https:" });
  return aid;
}

export interface AnonVoteResult { ok: boolean; reason?: string; crowd_up: number; crowd_down: number; mine: number }

export async function castAnonVote(db: D1Database, repoId: number, aid: string, ipHash: string | null, value: -1 | 0 | 1, limits: { perAnonDay: number; perIpDay: number; perIpNewIds: number }): Promise<AnonVoteResult> {
  const day = new Date().toISOString().slice(0, 10);
  const counts = async () => {
    const r = await db.prepare("SELECT sum(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS up, sum(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS down FROM anon_votes WHERE repo_id = ?").bind(repoId).first<{ up: number | null; down: number | null }>();
    return { crowd_up: r?.up ?? 0, crowd_down: r?.down ?? 0 };
  };
  const mineRow = await db.prepare("SELECT value FROM anon_votes WHERE repo_id = ? AND anon_hash = ?").bind(repoId, aid).first<{ value: number }>();
  const mineVal: number = mineRow?.value ?? 0;
  if (value === 0) {
    await db.prepare("DELETE FROM anon_votes WHERE repo_id = ? AND anon_hash = ?").bind(repoId, aid).run();
  } else {
    // caps: per repo per day <= visitors today; per anon id; per network; and cheap new-id farms from one network
    const [todayVotes, views, mineToday, ipToday, ipIds] = await Promise.all([
      db.prepare("SELECT count(*) AS n FROM anon_votes WHERE repo_id = ? AND day = ?").bind(repoId, day).first<{ n: number }>(),
      viewsToday(db, repoId),
      db.prepare("SELECT count(*) AS n FROM anon_votes WHERE anon_hash = ? AND day = ?").bind(aid, day).first<{ n: number }>(),
      ipHash ? db.prepare("SELECT count(*) AS n FROM anon_votes WHERE ip_hash = ? AND day = ?").bind(ipHash, day).first<{ n: number }>() : Promise.resolve({ n: 0 }),
      ipHash ? db.prepare("SELECT count(DISTINCT anon_hash) AS n FROM anon_votes WHERE ip_hash = ? AND day = ?").bind(ipHash, day).first<{ n: number }>() : Promise.resolve({ n: 0 }),
    ]);
    const isNew = !mineRow;
    if (isNew && (todayVotes?.n ?? 0) >= Math.max(3, views)) return { ok: false, reason: "the crowd has voted as much as it has visited today; log in to vote for real", ...(await counts()), mine: mineVal };
    if ((mineToday?.n ?? 0) >= limits.perAnonDay) return { ok: false, reason: "daily crowd-vote limit reached; log in to vote for real", ...(await counts()), mine: mineVal };
    if (ipHash && (ipToday?.n ?? 0) >= limits.perIpDay) return { ok: false, reason: "this network has voted a lot today; log in to vote for real", ...(await counts()), mine: mineVal };
    if (ipHash && isNew && (ipIds?.n ?? 0) >= limits.perIpNewIds) return { ok: false, reason: "too many new anonymous voters from this network today", ...(await counts()), mine: mineVal };
    await db.prepare("INSERT INTO anon_votes (repo_id, anon_hash, ip_hash, value, day) VALUES (?,?,?,?,?) ON CONFLICT(repo_id, anon_hash) DO UPDATE SET value = excluded.value, ip_hash = excluded.ip_hash, day = excluded.day, created_at = unixepoch()").bind(repoId, aid, ipHash, value, day).run();
  }
  const c = await counts();
  await db.prepare("UPDATE repos SET crowd_up = ?, crowd_down = ? WHERE id = ?").bind(c.crowd_up, c.crowd_down, repoId).run();
  return { ok: true, ...c, mine: value };
}
