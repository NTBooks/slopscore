// Cron */10: 40 repos by next_crawl. One conditional GET each; 304 is free. Changes trigger a full re-scan.
import { markDirty } from "../lib/cache";
import { GitHub, fullNameFromRedirect, parseGhDate, type GhRepo } from "../lib/github";
import { scanRepo, delist, nextInterval } from "../lib/scan";
import type { Env } from "../env";
import type { RepoRow } from "../lib/db";
import { now } from "../lib/time";
import { setState } from "./stats";

export interface RecrawlResult { checked: number; unchanged: number; rescanned: number; delisted: number; renamed: number; revived: number }

export async function recrawl(env: Env, limit = 40): Promise<RecrawlResult> {
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  const out: RecrawlResult = { checked: 0, unchanged: 0, rescanned: 0, delisted: 0, renamed: 0, revived: 0 };
  const rows = await env.DB.prepare(
    "SELECT * FROM repos WHERE status IN ('listed','rejected','quarantined','hidden','delisted') AND (next_crawl IS NULL OR next_crawl <= ?) ORDER BY next_crawl ASC LIMIT ?",
  ).bind(now(), limit).all<RepoRow>().then((r) => r.results ?? []);

  for (const r of rows) {
    if (gh.throttled()) { await setState(env.DB, "recrawl:last_note", "github rate limit; waiting"); break; }
    out.checked++;
    await checkOne(env, gh, r, out);
  }
  await setState(env.DB, "recrawl:last_run", String(now()));
  return out;
}

/** Shared by the cron and the on-visit freshness check. */
export async function checkOne(env: Env, gh: GitHub, r: RepoRow, out?: RecrawlResult): Promise<"unchanged" | "rescanned" | "delisted" | "renamed" | "revived" | "error"> {
  const res = await gh.repo(r.owner, r.name, r.etag_repo);
  const t = now();
  if (res.status === 304) {
    await env.DB.prepare("UPDATE repos SET last_crawled = ?, next_crawl = ? WHERE id = ?").bind(t, t + nextInterval(r.pushed_at, r.hot), r.id).run();
    if (out) out.unchanged++;
    return "unchanged";
  }
  if (res.status >= 300 && res.status < 400 && "redirect" in res) {
    const moved = fullNameFromRedirect(res.redirect);
    if (moved && moved.toLowerCase() !== r.full_name.toLowerCase()) {
      const [owner, name] = moved.split("/");
      await env.DB.prepare("UPDATE repos SET full_name = ?, owner = ?, name = ?, last_crawled = ?, next_crawl = ? WHERE id = ?").bind(moved, owner, name, t, t + 3600, r.id).run();
      if (out) out.renamed++;
      return "renamed";
    }
  }
  if (res.status === 404 || res.status === 451 || res.status === 410 || (res.status === 403 && "blocked" in res && res.blocked)) {
    if (r.status === "delisted") {
      await env.DB.prepare("UPDATE repos SET last_crawled = ?, next_crawl = ? WHERE id = ?").bind(t, t + 30 * 86400, r.id).run();
      return "unchanged";
    }
    await delist(env.DB, r.id, res.status === 451 ? "dmca" : res.status === 403 ? "tos-block" : "404");
    if (out) out.delisted++;
    return "delisted";
  }
  if (res.status !== 200) {
    await env.DB.prepare("UPDATE repos SET last_crawled = ?, next_crawl = ? WHERE id = ?").bind(t, t + 6 * 3600, r.id).run();
    return "error";
  }
  const g = res.data as GhRepo;
  const pushed = parseGhDate(g.pushed_at);
  const changed = pushed !== r.pushed_at || g.full_name !== r.full_name || g.archived !== Boolean(r.archived) || g.disabled;
  if (r.status === "delisted") {
    // gone-and-back: only revive when the owner didn't remove it and the marker is present
    if (r.removed_reason === "owner-request") { await env.DB.prepare("UPDATE repos SET last_crawled = ?, next_crawl = ? WHERE id = ?").bind(t, t + 30 * 86400, r.id).run(); return "unchanged"; }
    const raw = await gh.rawFile(g.owner.login, g.name, g.default_branch, "slopscore.md", 1000);
    if (raw.status === 200) {
      await env.DB.prepare("UPDATE repos SET status = 'discovered', queue_reason = 'awaiting-scan', removed_at = NULL, removed_reason = NULL, first_seen = ?, last_crawled = ?, next_crawl = ? WHERE id = ?").bind(t, t, t + 3600, r.id).run();
      if (out) out.revived++;
      return "revived";
    }
    await env.DB.prepare("UPDATE repos SET last_crawled = ?, next_crawl = ? WHERE id = ?").bind(t, t + 30 * 86400, r.id).run();
    return "unchanged";
  }
  if (!changed) {
    await env.DB.prepare("UPDATE repos SET stars = ?, forks = ?, etag_repo = ?, last_crawled = ?, next_crawl = ? WHERE id = ?").bind(g.stargazers_count, g.forks_count, res.etag, t, t + nextInterval(pushed, r.hot), r.id).run();
    if (g.stargazers_count !== r.stars || g.forks_count !== r.forks) await markDirty(env.DB);
    if (out) out.unchanged++;
    return "unchanged";
  }
  const scanned = await scanRepo(env.DB, env, gh, g.owner.login, g.name);
  if ("error" in scanned.outcome) { if (out) out.delisted++; return "delisted"; }
  if (out) out.rescanned++;
  return "rescanned";
}
