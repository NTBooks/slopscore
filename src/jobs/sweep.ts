// Cron */15: GitHub code search for marker files. Unknown repos are inserted as `discovered` (tier found).
import { GitHub } from "../lib/github";
import type { Env } from "../env";
import { bump, setState } from "./stats";

export async function sweep(env: Env): Promise<{ pages: number; found: number; note?: string }> {
  if (!env.GITHUB_CRAWL_TOKEN) return { pages: 0, found: 0, note: "no GITHUB_CRAWL_TOKEN; code search needs auth" };
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  let found = 0;
  let pages = 0;
  for (let page = 1; page <= 10; page++) {
    if (gh.throttled()) break;
    const r = await gh.codeSearch(page);
    if (r.status !== 200 || !r.data) { await setState(env.DB, "sweep:last_error", `${r.status} ${"error" in r ? r.error : ""}`); break; }
    pages++;
    const items = r.data.items.filter((i) => i.path === "slopscore.md" && !i.repository.private);
    if (!items.length) break;
    const names = items.map((i) => i.repository.full_name.toLowerCase());
    const known = await env.DB.prepare(`SELECT lower(full_name) AS n FROM repos WHERE lower(full_name) IN (${names.map(() => "?").join(",")})`).bind(...names).all<{ n: string }>();
    const knownSet = new Set((known.results ?? []).map((k) => k.n));
    const fresh = items.filter((i) => !knownSet.has(i.repository.full_name.toLowerCase()));
    if (fresh.length) {
      await env.DB.batch(fresh.map((i) => {
        const [owner, name] = i.repository.full_name.split("/");
        return env.DB.prepare("INSERT OR IGNORE INTO repos (id, full_name, owner, name, owner_id, status, queue_reason, is_fork) VALUES (?,?,?,?,?, 'discovered', 'awaiting-scan', ?)")
          .bind(i.repository.id, i.repository.full_name, owner, name, null, i.repository.fork ? 1 : 0);
      }));
      found += fresh.length;
    }
    // sorted by indexed desc: once a whole page is already known, older pages are too
    if (fresh.length === 0 && page > 1) break;
    if (r.data.items.length < 100) break;
  }
  if (found) await bump(env.DB, "found", found);
  await setState(env.DB, "sweep:last_run", String(Math.floor(Date.now() / 1000)));
  await setState(env.DB, "sweep:last_found", String(found));
  return { pages, found };
}
