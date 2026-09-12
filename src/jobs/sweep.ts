// Cron */15: GitHub code search for marker files. Unknown repos are inserted as `discovered` (tier found).
// A repo the trawl already grabbed and that turns out to carry the file is promoted on the spot: the owner opted in,
// so it leaves the Cap'm's lane for the human one instead of waiting behind our own expedition.
import { GitHub } from "../lib/github";
import type { Env } from "../env";
import { bump, setState } from "./stats";
import { markDirty } from "../lib/cache";
import { logAction } from "../lib/db";

export async function sweep(env: Env): Promise<{ pages: number; found: number; promoted?: number; note?: string }> {
  if (!env.GITHUB_CRAWL_TOKEN) return { pages: 0, found: 0, note: "no GITHUB_CRAWL_TOKEN; code search needs auth" };
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  let found = 0;
  let promoted = 0;
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
    const dupes = names.filter((n) => knownSet.has(n));
    if (dupes.length) promoted += await promoteTrawled(env, dupes);
    // sorted by indexed desc: once a whole page is already known, older pages are too
    if (fresh.length === 0 && page > 1) break;
    if (r.data.items.length < 100) break;
  }
  if (found) { await bump(env.DB, "found", found); await markDirty(env.DB); } // /queue's feed is cached by data version
  await setState(env.DB, "sweep:last_run", String(Math.floor(Date.now() / 1000)));
  await setState(env.DB, "sweep:last_found", String(found));
  return { pages, found, promoted };
}

/** Trawled repos still waiting to be scanned that now have slopscore.md: the file wins, so they move to the human line. */
async function promoteTrawled(env: Env, names: string[]): Promise<number> {
  const ph = names.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, full_name FROM repos WHERE lower(full_name) IN (${ph}) AND status = 'discovered' AND source = 'trawl'`,
  ).bind(...names).all<{ id: number; full_name: string }>().then((r) => r.results ?? []);
  if (!rows.length) return 0;
  await env.DB.batch(rows.map((r) => env.DB.prepare("UPDATE repos SET source = 'marker', virtual_md = NULL, virtual_reason = NULL WHERE id = ?").bind(r.id)));
  for (const r of rows) {
    await logAction(env.DB, { actor: "system", role: "system", action: "adopted", targetType: "repo", targetId: r.id, label: r.full_name, note: "the owner committed slopscore.md before we scanned; the Cap'm's paperwork is retired and it joins the free line" });
  }
  return rows.length;
}
