// "Jump the line": a paid rush. Shared by Stripe (humans) and x402 (agents). The payment buys the wait, never a gate.
import type { Env } from "../env";
import { logAction, type RepoRow } from "./db";
import { GitHub } from "./github";
import { scanRepo } from "./scan";
import { now } from "./time";

export interface RushInput {
  provider: "stripe" | "x402";
  externalId: string;         // Stripe session id or x402 tx hash; idempotency key
  repoId: number;
  userId: number | null;
  payer: string;              // login or abbreviated wallet
  amountCents: number;
  currency?: string;
}

export interface RushResult { ok: boolean; duplicate?: boolean; mode: "immediate" | "priority"; status?: string; message: string }

/** True when a paid scan can run right now (paid plan, or OpenRouter takes the AI work off the free budget). */
export function immediateMode(env: Env): boolean {
  return env.PLAN_MODE === "paid" || Boolean(env.OPENROUTER_API_KEY);
}

export async function rushRepo(env: Env, input: RushInput, ctx?: { waitUntil: (p: Promise<unknown>) => void }): Promise<RushResult> {
  const db = env.DB;
  const mode: RushResult["mode"] = immediateMode(env) ? "immediate" : "priority";
  const ins = await db.prepare(
    "INSERT OR IGNORE INTO payments (provider, repo_id, user_id, payer, amount_cents, currency, external_id) VALUES (?,?,?,?,?,?,?)",
  ).bind(input.provider, input.repoId, input.userId, input.payer, input.amountCents, input.currency ?? "usd", input.externalId).run();
  if (!ins.meta.changes) return { ok: true, duplicate: true, mode, message: "already processed" };

  const repo = await db.prepare("SELECT * FROM repos WHERE id = ?").bind(input.repoId).first<RepoRow>();
  if (!repo) return { ok: false, mode, message: "unknown repo" };

  // Rejected repos re-enter detection (the owner paid to be looked at again); listed ones just get a fresh scan.
  const t = now();
  if (repo.status === "rejected" || repo.status === "discovered") {
    await db.prepare("UPDATE repos SET status = 'discovered', queue_reason = 'rushed', priority_at = ?, reject_reason = NULL WHERE id = ?").bind(t, repo.id).run();
  } else {
    await db.prepare("UPDATE repos SET priority_at = ? WHERE id = ?").bind(t, repo.id).run();
  }
  await logAction(db, {
    actor: input.payer, role: "owner", action: input.provider === "stripe" ? "donation" : "rush-paid", targetType: "repo", targetId: repo.id, label: repo.full_name,
    note: `$${(input.amountCents / 100).toFixed(2)} ${input.provider} · ${mode === "immediate" ? "scanned now" : "front of the line"}`,
  });

  if (mode === "immediate") {
    const run = async () => {
      const res = await scanRepo(db, env, new GitHub(env.GITHUB_CRAWL_TOKEN), repo.owner, repo.name, { paid: true, ignoreBudget: true, byOwner: true });
      if (res.repo) await db.prepare("UPDATE repos SET priority_at = NULL WHERE id = ?").bind(repo.id).run();
      return res;
    };
    if (ctx) { ctx.waitUntil(run()); return { ok: true, mode, status: "scanning", message: "Paid. Scanning now; the page updates in a moment." }; }
    const res = await run();
    return { ok: true, mode, status: res.repo?.status, message: `Paid and scanned: ${res.repo?.status ?? "missing"}.` };
  }
  return { ok: true, mode, status: "discovered", message: "Paid. You're at the front of the line for the next scan window." };
}

/** Public ledger for /stats: income by provider vs an estimate of what the site costs. */
export async function ledger(db: D1Database, env: Env) {
  const since30 = now() - 30 * 86400;
  const rows = await db.prepare(
    "SELECT provider, sum(CASE WHEN created_at >= ? THEN amount_cents ELSE 0 END) AS cents_30d, sum(amount_cents) AS cents_all, count(*) AS n FROM payments GROUP BY provider",
  ).bind(since30).all<{ provider: string; cents_30d: number; cents_all: number; n: number }>().then((r) => r.results ?? []);
  const scans30 = await db.prepare("SELECT COALESCE(sum(scans), 0) AS n, COALESCE(sum(neurons_used), 0) AS neurons FROM stats_daily WHERE date >= date('now', '-30 days')").first<{ n: number; neurons: number }>();
  const paid = env.PLAN_MODE === "paid";
  const estimate = {
    workers_plan_cents: paid ? 500 : 0,
    domain_cents: Math.round(1100 / 12),
    ai_overage_cents: paid ? Math.round(Math.max(0, (scans30?.neurons ?? 0) - 30 * 10_000) / 1000 * 1.1) : 0,
    openrouter_cents: Math.round(rows.reduce((a, r) => a + r.n, 0) * 0.2),   // ~$0.002 per paid scan
  };
  const cost_cents = estimate.workers_plan_cents + estimate.domain_cents + estimate.ai_overage_cents + estimate.openrouter_cents;
  const income_30d = rows.reduce((a, r) => a + r.cents_30d, 0);
  return { providers: rows, income_30d_cents: income_30d, income_all_cents: rows.reduce((a, r) => a + r.cents_all, 0), cost_30d_estimate_cents: cost_cents, estimate, scans_30d: scans30?.n ?? 0, covered: cost_cents === 0 ? true : income_30d >= cost_cents };
}
