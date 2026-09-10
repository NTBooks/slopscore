// Vote weighting and anti-botting, borrowing what is publicly known about Reddit's approach:
//  - only logged-in accounts vote at all (we require GitHub login; account age / public-repo threshold to write)
//  - votes from low-trust or suspected-manipulation accounts count less or not at all ("vote scoring")
//  - per-account and per-IP rate limits, and detection of vote rings (bursts of new accounts on one target)
//  - displayed totals are fuzzed slightly so a bot can't tell whether its vote counted
// Everything here is public in the repo; the numbers are knobs, not secrets.

import type { UserRow } from "./db";
import { now } from "./time";

const DAY = 86400;

/** 0..1. Derived only from GitHub signals we already store; recomputed at login. */
export function trustFor(u: Pick<UserRow, "gh_created_at" | "public_repos" | "followers" | "banned_at">): number {
  if (u.banned_at) return 0;
  const age = now() - (u.gh_created_at ?? now());
  let t = 0.5;                                  // a young or empty account
  if (age >= 365 * DAY || u.public_repos >= 10) t = 1;
  else if (age >= 90 * DAY) t = 0.75;
  if (u.followers >= 25 && t < 1) t = Math.min(1, t + 0.25);
  return t;
}

/** Fuzz a displayed score by up to ±(2%) for scores above 20 so exact counts aren't observable. Deterministic per repo. */
export function fuzz(score: number, seed: number): number {
  if (Math.abs(score) < 20) return score;
  const jitter = ((seed * 9301 + 49297) % 233280) / 233280; // 0..1, stable for a given repo id
  const delta = Math.round((jitter - 0.5) * 0.04 * Math.abs(score));
  return score + delta;
}

/** Hash an IP for ring detection without storing the IP. */
export async function ipHash(ip: string | undefined, secret: string): Promise<string | null> {
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RingCheck { suspicious: boolean; reason?: string }

/**
 * Vote-ring heuristic run after a vote: many votes on one repo in the last hour from accounts
 * created within the same week, or from the same IP hash. Suspicious votes get weight 0 (kept for audit).
 */
export async function ringCheck(db: D1Database, repoId: number, ipHashValue: string | null): Promise<RingCheck> {
  const hourAgo = now() - 3600;
  const r = await db.prepare(
    `SELECT count(*) AS n,
            count(DISTINCT v.ip_hash) AS ips,
            count(DISTINCT (u.gh_created_at / 604800)) AS weeks
     FROM votes v JOIN users u ON u.id = v.user_id WHERE v.repo_id = ? AND v.created_at >= ?`,
  ).bind(repoId, hourAgo).first<{ n: number; ips: number; weeks: number }>();
  if (!r) return { suspicious: false };
  if (r.n >= 8 && r.weeks <= 1) return { suspicious: true, reason: `${r.n} votes in an hour from accounts created the same week` };
  if (ipHashValue && r.n >= 5 && r.ips <= 1) return { suspicious: true, reason: `${r.n} votes in an hour from one network` };
  return { suspicious: false };
}
