// Cron */5: scan discovered repos. Two lanes, drained in that order and budgeted apart:
//   1. the human lane — paid jumpers (priority_at) first, FIFO, then everyone who opted in, FIFO. This is the only
//      lane that can spend Workers AI neurons, so the free tier stays for the people who came to us. It stops early
//      when the AI budget is spent; those repos stay discovered with queue_reason = ai-budget.
//   2. the trawl lane — the Cap'm's own finds. Its own per-tick allowance, and it runs only when OPENROUTER_API_KEY
//      is set, because our expeditions pay their own way: never a free slot, never a neuron.
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";
import { budgetAllows } from "../lib/content";
import type { Env } from "../env";
import type { RepoRow } from "../lib/db";
import { bump, setBudget, setState } from "./stats";

const PER_RUN = 4;
const MIN_NEURONS = 250;

export interface LaneResult { scanned: number; deferred: number; results: { repo: string; status: string }[]; note?: string }
export interface ScanTick extends LaneResult { trawl: LaneResult }

/** Scan up to `limit` of `rows`. `ours` = the AI work goes to OpenRouter, so the neuron budget is neither read nor spent. */
async function drain(env: Env, gh: GitHub, rows: RepoRow[], limit: number, ours: boolean): Promise<LaneResult> {
  const out: LaneResult = { scanned: 0, deferred: 0, results: [] };
  for (const r of rows) {
    if (out.scanned >= limit) break;
    if (gh.throttled()) { out.note = "github rate limit; waiting"; break; }
    const paid = r.priority_at != null;
    const viaOpenRouter = ours || (paid && Boolean(env.OPENROUTER_API_KEY));
    const paidPath = viaOpenRouter || (paid && env.PLAN_MODE === "paid");
    const budget = paidPath ? { ok: true } : await budgetAllows(env.DB, env, MIN_NEURONS);
    if (!budget.ok) {
      // mark the free line as waiting (once), keep the rows for tomorrow
      if (r.queue_reason !== "ai-budget") {
        await env.DB.prepare("UPDATE repos SET queue_reason = 'ai-budget' WHERE id = ?").bind(r.id).run();
        out.deferred++;
      }
      continue;
    }
    const res = await scanRepo(env.DB, env, gh, r.owner, r.name, { ignoreBudget: paidPath, paid: viaOpenRouter });
    out.scanned++;
    const status = "error" in res.outcome ? `missing: ${res.outcome.error}` : res.outcome.status;
    if (!("error" in res.outcome) && res.outcome.deferred) out.deferred++;
    if (res.repo && r.priority_at != null && res.repo.status !== "discovered") {
      await env.DB.prepare("UPDATE repos SET priority_at = NULL WHERE id = ?").bind(r.id).run();
    }
    out.results.push({ repo: r.full_name, status });
  }
  return out;
}

export async function scanQueue(env: Env, limit = PER_RUN): Promise<ScanTick> {
  limit = Math.min(Math.max(1, Math.floor(limit)), 25); // one request's worth of GitHub + AI calls, per lane
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  await setBudget(env.DB, Number(env.AI_NEURON_BUDGET || 9000));
  const ours = Boolean(env.OPENROUTER_API_KEY);

  // The human lane: paid jumpers of any source, then opted-in repos. Trawled finds are never in it.
  const humans = await env.DB.prepare(
    "SELECT * FROM repos WHERE status = 'discovered' AND (priority_at IS NOT NULL OR source <> 'trawl') ORDER BY priority_at IS NULL, priority_at ASC, first_seen ASC LIMIT ?",
  ).bind(limit * 2).all<RepoRow>().then((r) => r.results ?? []);
  const out: ScanTick = { ...(await drain(env, gh, humans, limit, false)), trawl: { scanned: 0, deferred: 0, results: [] } };

  // The trawl lane: our own work, on our own dime. No key, no lane — the finds wait rather than eat the free budget.
  if (!ours) out.trawl.note = "no OPENROUTER_API_KEY: trawled finds wait instead of spending the free AI budget";
  else {
    const trawled = await env.DB.prepare(
      "SELECT * FROM repos WHERE status = 'discovered' AND priority_at IS NULL AND source = 'trawl' ORDER BY first_seen ASC LIMIT ?",
    ).bind(limit).all<RepoRow>().then((r) => r.results ?? []);
    out.trawl = await drain(env, gh, trawled, limit, true);
  }

  const deferred = out.deferred + out.trawl.deferred;
  if (deferred) await bump(env.DB, "deferred", deferred);
  await setState(env.DB, "scan:last_run", String(Math.floor(Date.now() / 1000)));
  const note = out.note ?? out.trawl.note;
  if (note) await setState(env.DB, "scan:last_note", note);
  return out;
}
