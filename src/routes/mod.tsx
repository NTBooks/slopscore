// Admin console: report queue, quarantine bucket, held comments, bans, buckets, denylist. Every action lands in the public log.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { allBuckets, logAction, getRepoById, type RepoRow } from "../lib/db";
import { requireUser, body, wantsJson } from "../middleware";
import { Layout } from "../views/layout";
import { ago } from "../lib/time";
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";

export const mod = new Hono<AppEnv>();

mod.use("*", async (c, next) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "login required", login: "/auth/github?next=/mod" }, 401);
  if (!u.isAdmin) return c.json({ error: "admins only" }, 403);
  await next();
});

interface ReportRow { id: number; target_type: "repo" | "comment"; target_id: number; reason: string; note: string | null; created_at: number; reporter: string; label: string | null; status: string | null; body: string | null; author: string | null }

mod.get("/", async (c) => {
  const user = c.get("user")!; const url = new URL(c.req.url);
  const db = c.env.DB;
  const [reports, quarantined, hidden, held, banned, buckets, deny] = await Promise.all([
    db.prepare(
      `SELECT rp.id, rp.target_type, rp.target_id, rp.reason, rp.note, rp.created_at, u.login AS reporter,
         CASE rp.target_type WHEN 'repo' THEN r.full_name ELSE r2.full_name END AS label,
         CASE rp.target_type WHEN 'repo' THEN r.status ELSE NULL END AS status,
         cm.body_md AS body, cu.login AS author
       FROM reports rp JOIN users u ON u.id = rp.user_id
       LEFT JOIN repos r ON rp.target_type = 'repo' AND r.id = rp.target_id
       LEFT JOIN comments cm ON rp.target_type = 'comment' AND cm.id = rp.target_id
       LEFT JOIN repos r2 ON cm.repo_id = r2.id
       LEFT JOIN users cu ON cu.id = cm.user_id
       WHERE rp.resolved_at IS NULL ORDER BY rp.created_at DESC LIMIT 200`,
    ).all<ReportRow>().then((r) => r.results ?? []),
    db.prepare("SELECT * FROM repos WHERE status = 'quarantined' ORDER BY first_seen ASC LIMIT 100").all<RepoRow>().then((r) => r.results ?? []),
    db.prepare("SELECT * FROM repos WHERE status = 'hidden' ORDER BY first_seen DESC LIMIT 100").all<RepoRow>().then((r) => r.results ?? []),
    db.prepare("SELECT c.id, c.body_md, c.held_reason, c.created_at, u.login, r.full_name FROM comments c JOIN users u ON u.id = c.user_id JOIN repos r ON r.id = c.repo_id WHERE c.hidden_at IS NOT NULL AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 100").all<{ id: number; body_md: string; held_reason: string | null; created_at: number; login: string; full_name: string }>().then((r) => r.results ?? []),
    db.prepare("SELECT id, login, banned_at, ban_reason FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC LIMIT 100").all<{ id: number; login: string; banned_at: number; ban_reason: string | null }>().then((r) => r.results ?? []),
    allBuckets(db),
    db.prepare("SELECT term, kind, scope, added_by, created_at FROM denylist ORDER BY created_at DESC").all<{ term: string; kind: string; scope: string; added_by: string | null; created_at: number }>().then((r) => r.results ?? []),
  ]);
  // group reports by target
  const groups = new Map<string, ReportRow[]>();
  for (const r of reports) { const k = `${r.target_type}:${r.target_id}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const csrf = <input type="hidden" name="csrf" value={user.csrf} />;
  const act = (action: string, label: string, url: string, cls = "btn secondary", confirm?: string) => (
    <form method="post" action={url} class="inline" onsubmit={confirm ? `return confirm(${JSON.stringify(confirm)})` : undefined}>{csrf}<button class={cls} name="action" value={action}>{label}</button></form>
  );

  return c.html(
    <Layout meta={{ title: "Mod — SlopScore", noindex: true }} user={user} url={url}>
      <section class="wrap narrow" style="padding:0">
        <h2>Mod console</h2>
        <p class="muted">Every action here lands in the <a href="/log">public log</a> with your login. Nothing here is a secret.</p>

        <h3>Reports <span class="muted">· {groups.size} targets, {reports.length} reports</span></h3>
        {groups.size === 0 ? <div class="empty">Nothing reported. Suspicious.</div> : null}
        {[...groups.entries()].map(([key, rs]) => {
          const first = rs[0];
          const isRepo = first.target_type === "repo";
          return (
            <div class="modcard" id={key}>
              <div>
                {isRepo ? <><strong><a href={`/r/${first.label}`}>{first.label}</a></strong> <span class="chip">{first.status}</span></> : <><strong>comment</strong> by <a href={`/u/${first.author}`}>{first.author}</a> on <a href={`/r/${first.label}#c${first.target_id}`}>{first.label}</a><blockquote class="muted">{(first.body ?? "").slice(0, 300)}</blockquote></>}
              </div>
              <ul class="muted small">{rs.map((r) => <li><strong>{r.reason}</strong> · {r.reporter} · {ago(r.created_at)}{r.note ? ` · "${r.note}"` : ""}</li>)}</ul>
              <div class="actions">
                {act("dismiss", "dismiss", `/mod/report/${key}`)}
                {isRepo ? (
                  <>
                    {first.status !== "hidden" ? act("hide", "hide", `/mod/report/${key}`) : act("restore", "restore", `/mod/report/${key}`)}
                    {act("hide_images", "hide images", `/mod/report/${key}`)}
                    {act("delist", "delist (lock)", `/mod/report/${key}`, "btn secondary", "Delist and lock? The recrawl will not relist it until you restore.")}
                    {act("ban_owner", "ban owner", `/mod/report/${key}`, "btn secondary", "Ban the repo owner's account?")}
                  </>
                ) : (
                  <>
                    {act("delete_comment", "delete comment", `/mod/report/${key}`)}
                    {act("ban_user", "ban author", `/mod/report/${key}`, "btn secondary", "Ban the comment author?")}
                  </>
                )}
                <a class="muted" href={`https://github.com/contact/report-content?content_url=${encodeURIComponent(`https://github.com/${first.label}`)}&report=${encodeURIComponent("other")}`} target="_blank" rel="noopener">report to GitHub ↗</a>
              </div>
            </div>
          );
        })}

        <h3>Quarantined <span class="muted">· awaiting a human · {quarantined.length}</span></h3>
        {quarantined.length === 0 ? <div class="empty">Nobody is in quarantine.</div> : null}
        {quarantined.map((r) => <RepoCard r={r} csrf={csrf} act={act} kind="quarantined" />)}

        <h3>Hidden by reports <span class="muted">· {hidden.length}</span></h3>
        {hidden.length === 0 ? <div class="empty">Nothing hidden.</div> : null}
        {hidden.map((r) => <RepoCard r={r} csrf={csrf} act={act} kind="hidden" />)}

        <h3>Held comments <span class="muted">· {held.length}</span></h3>
        {held.length === 0 ? <div class="empty">No comments held.</div> : null}
        {held.map((h) => (
          <div class="modcard">
            <div><a href={`/u/${h.login}`}>{h.login}</a> on <a href={`/r/${h.full_name}#c${h.id}`}>{h.full_name}</a> · {ago(h.created_at)} · <span class="chip warn">{h.held_reason}</span></div>
            <blockquote class="muted">{h.body_md.slice(0, 400)}</blockquote>
            <div class="actions">{act("release", "release", `/mod/comment/${h.id}`)}{act("delete", "delete", `/mod/comment/${h.id}`)}{act("ban", "ban author", `/mod/comment/${h.id}`, "btn secondary", "Ban this author?")}</div>
          </div>
        ))}

        <h3>Banned slopsmiths <span class="muted">· {banned.length}</span></h3>
        {banned.map((b) => <div class="modcard"><a href={`/u/${b.login}`}>{b.login}</a> · banned {ago(b.banned_at)} · <span class="muted">{b.ban_reason}</span> <div class="actions">{act("unban", "unban", `/mod/user/${b.id}`)}</div></div>)}
        <form method="post" action="/mod/user/by-login" class="inline">{csrf}<input type="text" name="login" placeholder="github login" required /> <input type="text" name="reason" placeholder="reason" maxlength={120} /> <button class="btn secondary" name="action" value="ban">ban by login</button></form>

        <h3>Slopbuckets</h3>
        <table class="list"><tr><th>bucket</th><th>who</th><th>slop</th><th>state</th><th></th></tr>
          {buckets.map((b) => (
            <tr>
              <td><a href={`/b/${b.slug}`}>{b.slug}</a> <span class="muted">{b.title}</span></td>
              <td class="muted">{b.curated ? "curated" : b.created_by ?? "community"}</td>
              <td>{b.n}</td>
              <td>{b.banned ? <span class="chip bad">banned · {b.banned_reason}</span> : <span class="chip ok">open</span>}</td>
              <td>
                {b.banned ? (
                  <form method="post" action={`/mod/bucket/${b.slug}/unban`} class="inline">{csrf}<button class="btn secondary">unban</button></form>
                ) : (
                  <form method="post" action={`/mod/bucket/${b.slug}/ban`} class="inline">{csrf}<input type="text" name="reason" placeholder="reason" maxlength={120} required /> <button class="btn secondary">ban</button></form>
                )}
                {!b.curated && !b.banned ? <form method="post" action={`/mod/bucket/${b.slug}/curate`} class="inline">{csrf}<button class="btn secondary">promote</button></form> : null}
              </td>
            </tr>
          ))}
        </table>

        <h3>Denylist</h3>
        <p class="muted">Applies on the next scan. <code>slur</code> rejects in titles/tags and flags in bodies; <code>spam</code> flags; <code>domain</code> rejects links to that host.</p>
        <form method="post" action="/mod/denylist" class="inline">{csrf}
          <input type="text" name="term" placeholder="term or domain" required maxlength={80} />
          <select name="kind"><option value="slur">slur</option><option value="spam">spam</option><option value="domain">domain</option></select>
          <button class="btn secondary">add</button>
        </form>
        <table class="list"><tr><th>term</th><th>kind</th><th>by</th><th></th></tr>
          {deny.map((d) => <tr><td>{d.term}</td><td>{d.kind}</td><td class="muted">{d.added_by}</td><td><form method="post" action="/mod/denylist/remove" class="inline">{csrf}<input type="hidden" name="term" value={d.term} /><button class="link">remove</button></form></td></tr>)}
        </table>
      </section>
    </Layout>,
  );
});

const RepoCard = ({ r, csrf, act, kind }: { r: RepoRow; csrf: unknown; act: (a: string, l: string, u: string, cls?: string, confirm?: string) => unknown; kind: "quarantined" | "hidden" }) => {
  const scan = r.scan ? (JSON.parse(r.scan) as { risk?: { score: number; reasons: string[] } }) : null;
  return (
    <div class="modcard">
      <div><strong><a href={`/r/${r.full_name}`}>{r.full_name}</a></strong> <span class="muted">— {r.tagline}</span> · risk {r.risk} · {kind === "hidden" ? `${r.report_count} reports` : `found ${ago(r.first_seen)}`}</div>
      {scan?.risk?.reasons?.length ? <ul class="muted small">{scan.risk.reasons.map((x) => <li>{x}</li>)}</ul> : null}
      <div class="actions">
        {act("approve", kind === "hidden" ? "restore (list)" : "approve (list)", `/mod/repo/${r.id}`)}
        {act("rescan", "rescan", `/mod/repo/${r.id}`)}
        {act("hide_images", "hide images", `/mod/repo/${r.id}`)}
        {act("reject", "reject", `/mod/repo/${r.id}`)}
        {act("delist", "delist (lock)", `/mod/repo/${r.id}`, "btn secondary", "Delist and lock?")}
        {act("ban_owner", "ban owner", `/mod/repo/${r.id}`, "btn secondary", "Ban the owner's account?")}
        {csrf ? null : null}
      </div>
    </div>
  );
};

// ---- repo actions ----
async function repoAction(c: Context<AppEnv>, repo: RepoRow, action: string, note: string): Promise<string> {
  const db = c.env.DB; const admin = c.get("user")!.login;
  const log = (a: string, n?: string) => logAction(db, { actor: admin, role: "admin", action: a, targetType: "repo", targetId: repo.id, label: repo.full_name, note: n ?? note });
  switch (action) {
    case "approve": case "restore":
      await db.prepare("UPDATE repos SET status = 'listed', queue_reason = NULL, listed_at = COALESCE(listed_at, unixepoch()), locked_by = NULL, removed_at = NULL, removed_reason = NULL, mod_note = ? WHERE id = ?").bind(note || null, repo.id).run();
      await db.prepare("UPDATE reports SET resolved_at = unixepoch(), resolved_by = ?, resolution = ? WHERE target_type = 'repo' AND target_id = ? AND resolved_at IS NULL").bind(admin, action, repo.id).run();
      await db.prepare("UPDATE repos SET report_count = 0 WHERE id = ?").bind(repo.id).run();
      await log(action); return "Listed.";
    case "hide":
      await db.prepare("UPDATE repos SET status = 'hidden', queue_reason = 'admin', locked_by = ?, mod_note = ? WHERE id = ?").bind(admin, note || null, repo.id).run();
      await log("hide"); return "Hidden.";
    case "hide_images":
      await db.prepare("UPDATE repos SET images_hidden = 1 WHERE id = ?").bind(repo.id).run();
      await log("hide_images"); return "Images hidden; listing kept.";
    case "reject":
      await db.prepare("UPDATE repos SET status = 'rejected', queue_reason = NULL, reject_reason = ?, locked_by = ?, mod_note = ? WHERE id = ?").bind(`Moderator action: ${note || "rejected by a moderator"}`, admin, note || null, repo.id).run();
      await log("reject"); return "Rejected.";
    case "delist":
      await db.prepare("UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = 'admin', locked_by = ?, mod_note = ? WHERE id = ?").bind(admin, note || null, repo.id).run();
      await db.prepare("UPDATE reports SET resolved_at = unixepoch(), resolved_by = ?, resolution = 'delist' WHERE target_type = 'repo' AND target_id = ? AND resolved_at IS NULL").bind(admin, repo.id).run();
      await log("delist"); return "Delisted and locked.";
    case "rescan": {
      const res = await scanRepo(db, c.env, new GitHub(c.env.GITHUB_CRAWL_TOKEN), repo.owner, repo.name, { byAdmin: true });
      await log("rescan", res.outcome.status); return `Rescanned: ${res.outcome.status}.`;
    }
    case "ban_owner": {
      if (repo.owner_id == null) return "No owner id on this repo.";
      await db.prepare("UPDATE users SET banned_at = unixepoch(), ban_reason = ? WHERE id = ?").bind(note || `owner of ${repo.full_name}`, repo.owner_id).run();
      await db.prepare("UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = 'admin', locked_by = ? WHERE owner_id = ? AND status != 'delisted'").bind(admin, repo.owner_id).run();
      await logAction(db, { actor: admin, role: "admin", action: "ban", targetType: "user", targetId: repo.owner_id, label: repo.owner, note: note || `owner of ${repo.full_name}` });
      return "Owner banned; their repos delisted.";
    }
    case "dismiss":
      await db.prepare("UPDATE reports SET resolved_at = unixepoch(), resolved_by = ?, resolution = 'dismiss' WHERE target_type = 'repo' AND target_id = ? AND resolved_at IS NULL").bind(admin, repo.id).run();
      await db.prepare("UPDATE repos SET report_count = 0, status = CASE WHEN status = 'hidden' AND locked_by IS NULL THEN 'listed' ELSE status END, queue_reason = NULL WHERE id = ?").bind(repo.id).run();
      await log("dismiss-reports"); return "Reports dismissed.";
    default: return `Unknown action ${action}.`;
  }
}

mod.post("/repo/:id", requireUser, async (c) => {
  const repo = await getRepoById(c.env.DB, Number(c.req.param("id")));
  if (!repo) return c.json({ error: "unknown repo" }, 404);
  const b = await body(c);
  const msg = await repoAction(c, repo, b.action ?? "", (b.note ?? "").slice(0, 200));
  return wantsJson(c) ? c.json({ ok: true, message: msg }) : c.redirect(`/mod?flash=${encodeURIComponent(msg)}`);
});

mod.post("/report/:key", requireUser, async (c) => {
  const [type, idStr] = c.req.param("key").split(":");
  const id = Number(idStr);
  const b = await body(c);
  const action = b.action ?? "dismiss";
  const admin = c.get("user")!.login;
  const db = c.env.DB;
  if (type === "repo") {
    const repo = await getRepoById(db, id);
    if (!repo) return c.json({ error: "unknown repo" }, 404);
    const msg = await repoAction(c, repo, action, (b.note ?? "").slice(0, 200));
    return wantsJson(c) ? c.json({ ok: true, message: msg }) : c.redirect(`/mod?flash=${encodeURIComponent(msg)}`);
  }
  const cm = await db.prepare("SELECT c.id, c.user_id, r.full_name FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.id = ?").bind(id).first<{ id: number; user_id: number; full_name: string }>();
  if (!cm) return c.json({ error: "unknown comment" }, 404);
  let msg = "Dismissed.";
  if (action === "delete_comment") { await db.prepare("UPDATE comments SET deleted_at = unixepoch(), hidden_at = COALESCE(hidden_at, unixepoch()) WHERE id = ?").bind(id).run(); msg = "Comment deleted."; }
  if (action === "ban_user") {
    await db.prepare("UPDATE users SET banned_at = unixepoch(), ban_reason = ? WHERE id = ?").bind("comment reports", cm.user_id).run();
    await db.prepare("UPDATE comments SET deleted_at = unixepoch(), hidden_at = COALESCE(hidden_at, unixepoch()) WHERE id = ?").bind(id).run();
    await logAction(db, { actor: admin, role: "admin", action: "ban", targetType: "user", targetId: cm.user_id, note: "comment reports" });
    msg = "Author banned, comment deleted.";
  }
  await db.prepare("UPDATE reports SET resolved_at = unixepoch(), resolved_by = ?, resolution = ? WHERE target_type = 'comment' AND target_id = ? AND resolved_at IS NULL").bind(admin, action, id).run();
  await logAction(db, { actor: admin, role: "admin", action: `comment-${action}`, targetType: "comment", targetId: id, label: cm.full_name });
  return wantsJson(c) ? c.json({ ok: true, message: msg }) : c.redirect(`/mod?flash=${encodeURIComponent(msg)}`);
});

mod.post("/comment/:id", requireUser, async (c) => {
  const id = Number(c.req.param("id"));
  const b = await body(c);
  const admin = c.get("user")!.login;
  const db = c.env.DB;
  const cm = await db.prepare("SELECT c.id, c.user_id, c.repo_id, r.full_name FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.id = ?").bind(id).first<{ id: number; user_id: number; repo_id: number; full_name: string }>();
  if (!cm) return c.json({ error: "unknown comment" }, 404);
  const action = b.action ?? "release";
  if (action === "release") { await db.prepare("UPDATE comments SET hidden_at = NULL, held_reason = NULL WHERE id = ?").bind(id).run(); await db.prepare("UPDATE repos SET comment_count = comment_count + 1 WHERE id = ?").bind(cm.repo_id).run(); }
  if (action === "delete") await db.prepare("UPDATE comments SET deleted_at = unixepoch() WHERE id = ?").bind(id).run();
  if (action === "ban") {
    await db.prepare("UPDATE users SET banned_at = unixepoch(), ban_reason = 'held comment' WHERE id = ?").bind(cm.user_id).run();
    await db.prepare("UPDATE comments SET deleted_at = unixepoch() WHERE id = ?").bind(id).run();
    await logAction(db, { actor: admin, role: "admin", action: "ban", targetType: "user", targetId: cm.user_id, note: "held comment" });
  }
  await logAction(db, { actor: admin, role: "admin", action: `comment-${action}`, targetType: "comment", targetId: id, label: cm.full_name });
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod");
});

mod.post("/user/:id", requireUser, async (c) => {
  const b = await body(c);
  const admin = c.get("user")!.login;
  const db = c.env.DB;
  let id = Number(c.req.param("id"));
  let login = "";
  if (c.req.param("id") === "by-login") {
    const u = await db.prepare("SELECT id, login FROM users WHERE lower(login) = lower(?)").bind(b.login ?? "").first<{ id: number; login: string }>();
    if (!u) return c.json({ error: "no such slopsmith (they must have logged in at least once)" }, 404);
    id = u.id; login = u.login;
  }
  if (b.action === "unban") {
    await db.prepare("UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?").bind(id).run();
    await logAction(db, { actor: admin, role: "admin", action: "unban", targetType: "user", targetId: id, label: login || undefined });
  } else {
    await db.prepare("UPDATE users SET banned_at = unixepoch(), ban_reason = ? WHERE id = ?").bind((b.reason ?? "").slice(0, 120) || "banned by a moderator", id).run();
    await logAction(db, { actor: admin, role: "admin", action: "ban", targetType: "user", targetId: id, label: login || undefined, note: b.reason });
  }
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod");
});

// ---- buckets + denylist (unchanged from the first cut) ----
mod.post("/bucket/:slug/:action", requireUser, async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug").toLowerCase();
  const action = c.req.param("action");
  const b = await body(c);
  const exists = await c.env.DB.prepare("SELECT slug FROM tags WHERE slug = ?").bind(slug).first();
  if (!exists) return c.json({ error: "unknown bucket" }, 404);
  if (action === "ban") {
    const reason = (b.reason ?? "").slice(0, 120) || "out of control";
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE tags SET banned = 1, banned_reason = ? WHERE slug = ?").bind(reason, slug),
      c.env.DB.prepare("DELETE FROM repo_tags WHERE facet = 'slopbucket' AND value = ?").bind(slug),
    ]);
    await logAction(c.env.DB, { actor: user.login, role: "admin", action: "ban-bucket", targetType: "bucket", targetId: 0, label: slug, note: reason });
  } else if (action === "unban") {
    await c.env.DB.prepare("UPDATE tags SET banned = 0, banned_reason = NULL WHERE slug = ?").bind(slug).run();
    await logAction(c.env.DB, { actor: user.login, role: "admin", action: "unban-bucket", targetType: "bucket", targetId: 0, label: slug });
  } else if (action === "curate") {
    await c.env.DB.prepare("UPDATE tags SET curated = 1, sort = 200 WHERE slug = ?").bind(slug).run();
    await logAction(c.env.DB, { actor: user.login, role: "admin", action: "promote-bucket", targetType: "bucket", targetId: 0, label: slug });
  } else return c.json({ error: "unknown action" }, 400);
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod");
});

mod.post("/denylist", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const term = (b.term ?? "").trim().toLowerCase().slice(0, 80);
  const kind = ["slur", "spam", "domain"].includes(b.kind) ? b.kind : "spam";
  if (!term) return c.json({ error: "term required" }, 400);
  await c.env.DB.prepare("INSERT OR REPLACE INTO denylist (term, kind, scope, added_by) VALUES (?, ?, ?, ?)").bind(term, kind, kind === "slur" ? "title" : "any", user.login).run();
  await logAction(c.env.DB, { actor: user.login, role: "admin", action: "denylist-add", targetType: "denylist", targetId: 0, label: kind, note: kind === "domain" ? term : "(term withheld)" });
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod");
});

mod.post("/denylist/remove", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  await c.env.DB.prepare("DELETE FROM denylist WHERE term = ?").bind((b.term ?? "").toLowerCase()).run();
  await logAction(c.env.DB, { actor: user.login, role: "admin", action: "denylist-remove", targetType: "denylist", targetId: 0 });
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod");
});
