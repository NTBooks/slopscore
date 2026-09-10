// Cron */5: scan up to N discovered repos. Paid jumpers (priority_at) first, FIFO; then the free line, FIFO.
// Stops early when the AI budget is spent; those repos stay discovered with queue_reason = ai-budget.
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";
import { budgetAllows } from "../lib/content";
import type { Env } from "../env";
import type { RepoRow } from "../lib/db";
import { bump, setBudget, setState } from "./stats";

const PER_RUN = 4;
const MIN_NEURONS = 250;

export async function scanQueue(env: Env, limit = PER_RUN): Promise<{ scanned: number; deferred: number; results: { repo: string; status: string }[] }> {
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  await setBudget(env.DB, Number(env.AI_NEURON_BUDGET || 9000));
  const results: { repo: string; status: string }[] = [];
  let scanned = 0;
  let deferred = 0;
  const rows = await env.DB.prepare(
    "SELECT * FROM repos WHERE status = 'discovered' ORDER BY priority_at IS NULL, priority_at ASC, first_seen ASC LIMIT ?",
  ).bind(limit * 2).all<RepoRow>().then((r) => r.results ?? []);

  for (const r of rows) {
    if (scanned >= limit) break;
    if (gh.throttled()) { await setState(env.DB, "scan:last_note", "github rate limit; waiting"); break; }
    const paid = r.priority_at != null;
    const budget = await budgetAllows(env.DB, env, MIN_NEURONS);
    if (!budget.ok && !(paid && env.PLAN_MODE === "paid")) {
      // mark the free line as waiting (once), keep the rows for tomorrow
      if (r.queue_reason !== "ai-budget") {
        await env.DB.prepare("UPDATE repos SET queue_reason = 'ai-budget' WHERE id = ?").bind(r.id).run();
        deferred++;
      }
      continue;
    }
    const res = await scanRepo(env.DB, env, gh, r.owner, r.name, { ignoreBudget: paid && env.PLAN_MODE === "paid" });
    scanned++;
    const status = "error" in res.outcome ? `missing: ${res.outcome.error}` : res.outcome.status;
    if (!("error" in res.outcome) && res.outcome.deferred) deferred++;
    if (res.repo && r.priority_at != null && res.repo.status !== "discovered") {
      await env.DB.prepare("UPDATE repos SET priority_at = NULL WHERE id = ?").bind(r.id).run();
    }
    results.push({ repo: r.full_name, status });
  }
  if (deferred) await bump(env.DB, "deferred", deferred);
  await setState(env.DB, "scan:last_run", String(Math.floor(Date.now() / 1000)));
  return { scanned, deferred, results };
}
