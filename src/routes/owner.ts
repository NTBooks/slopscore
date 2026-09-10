// Owner controls: refresh, submit, remove, restore. Session login must be the repo owner or in the file's maintainers list.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getRepo, logAction, parseJson, rateLimit, type RepoRow } from "../lib/db";
import { requireUser, wantsJson } from "../middleware";
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";
import { now } from "../lib/time";

export const owner = new Hono<AppEnv>();

export function isOwnerOf(repo: RepoRow, login: string | undefined, userId: number | undefined): boolean {
  if (!login) return false;
  if (repo.owner_id != null && userId === repo.owner_id) return true;
  if (repo.owner.toLowerCase() === login.toLowerCase() && repo.owner_type !== "Organization") return true;
  const meta = parseJson<{ maintainers?: string[] }>(repo.meta, {});
  return (meta.maintainers ?? []).map((m) => m.toLowerCase()).includes(login.toLowerCase());
}

const RESUBMIT_AFTER = 180 * 86400;

owner.post("/:owner/:name/owner/:action", requireUser, async (c) => {
  const user = c.get("user")!;
  const repo = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!repo) return c.json({ error: "unknown repo" }, 404);
  if (!isOwnerOf(repo, user.login, user.id)) return c.json({ error: "not the owner (or not in maintainers:)" }, 403);
  const action = c.req.param("action");
  const back = (msg: string, extra: Record<string, unknown> = {}) =>
    wantsJson(c) ? c.json({ ok: true, action, message: msg, ...extra }) : c.redirect(`/r/${repo.full_name}?flash=${encodeURIComponent(msg)}`);
  const label = repo.full_name;

  switch (action) {
    case "refresh": {
      if (!(await rateLimit(c.env.DB, `owner-refresh:${repo.id}`, 1, 60))) return c.json({ error: "refresh at most once a minute" }, 429);
      const gh = new GitHub(c.env.GITHUB_CRAWL_TOKEN);
      // A rejected or delisted repo re-enters detection here; a listed one is re-evaluated in place.
      const res = await scanRepo(c.env.DB, gh, repo.owner, repo.name, { byOwner: true });
      await logAction(c.env.DB, { actor: user.login, role: "owner", action: "refresh", targetType: "repo", targetId: repo.id, label, note: res.outcome.status });
      return back(`Refreshed. Status: ${res.outcome.status}${"reject_reason" in res.outcome && res.outcome.reject_reason ? ` — ${res.outcome.reject_reason}` : ""}`, { status: res.outcome.status });
    }
    case "submit": {
      if (repo.status !== "listed") return c.json({ error: "submit is available once the repo is listed" }, 409);
      if (repo.tier === "submitted" && (repo.submitted_at ?? 0) > now() - RESUBMIT_AFTER) return c.json({ error: "already submitted in the last 180 days" }, 409);
      await c.env.DB.prepare("UPDATE repos SET tier = 'submitted', submitted_by = ?, submitted_at = unixepoch() WHERE id = ?").bind(user.id, repo.id).run();
      await logAction(c.env.DB, { actor: user.login, role: "owner", action: "submit", targetType: "repo", targetId: repo.id, label });
      return back("Submitted. This is your launch day. Good luck in the trough.");
    }
    case "remove": {
      if (repo.status === "delisted") return c.json({ error: "already removed" }, 409);
      await c.env.DB.prepare("UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = 'owner-request' WHERE id = ?").bind(repo.id).run();
      await logAction(c.env.DB, { actor: user.login, role: "owner", action: "remove", targetType: "repo", targetId: repo.id, label, note: "owner request" });
      return back("Removed. The page stays as a tombstone; you can restore it any time.");
    }
    case "restore": {
      if (repo.status !== "delisted" || repo.removed_reason !== "owner-request") return c.json({ error: "only owner-removed listings can be restored here" }, 409);
      await c.env.DB.prepare("UPDATE repos SET status = 'discovered', queue_reason = 'awaiting-scan', removed_at = NULL, removed_reason = NULL WHERE id = ?").bind(repo.id).run();
      await logAction(c.env.DB, { actor: user.login, role: "owner", action: "restore", targetType: "repo", targetId: repo.id, label });
      return back("Restored to the queue. It will be re-scanned; votes are intact.");
    }
    default:
      return c.json({ error: "unknown action; use refresh | submit | remove | restore" }, 400);
  }
});
