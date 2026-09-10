// Admin console. Phase 4 grows this into the full report queue; today: slopbucket bans and the denylist.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { allBuckets, logAction } from "../lib/db";
import { requireUser, body, wantsJson } from "../middleware";
import { Layout } from "../views/layout";

export const mod = new Hono<AppEnv>();

mod.use("*", async (c, next) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "login required", login: "/auth/github?next=/mod" }, 401);
  if (!u.isAdmin) return c.json({ error: "admins only" }, 403);
  await next();
});

mod.get("/", async (c) => {
  const user = c.get("user")!; const url = new URL(c.req.url);
  const [buckets, deny] = await Promise.all([
    allBuckets(c.env.DB),
    c.env.DB.prepare("SELECT term, kind, scope, added_by, created_at FROM denylist ORDER BY created_at DESC").all<{ term: string; kind: string; scope: string; added_by: string | null; created_at: number }>().then((r) => r.results ?? []),
  ]);
  return c.html(
    <Layout meta={{ title: "Mod — SlopScore", noindex: true }} user={user} url={url}>
      <section class="wrap narrow" style="padding:0">
        <h2>Mod console</h2>
        <p class="muted">Every action here lands in the <a href="/log">public log</a> with your login. Reports queue lands in phase 4.</p>

        <h3>Slopbuckets</h3>
        <p class="muted">Community buckets appear when a repo declares them. Ban one when it's out of control: its page 404s, it leaves the bar, and the crawler strips it from repos on their next scan (the repos stay listed).</p>
        <table class="list"><tr><th>bucket</th><th>who</th><th>slop</th><th>state</th><th></th></tr>
          {buckets.map((b) => (
            <tr>
              <td><a href={`/b/${b.slug}`}>{b.slug}</a> <span class="muted">{b.title}</span></td>
              <td class="muted">{b.curated ? "curated" : b.created_by ?? "community"}</td>
              <td>{b.n}</td>
              <td>{b.banned ? <span class="chip bad">banned · {b.banned_reason}</span> : <span class="chip ok">open</span>}</td>
              <td>
                {b.banned ? (
                  <form method="post" action={`/mod/bucket/${b.slug}/unban`} class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button class="btn secondary">unban</button></form>
                ) : (
                  <form method="post" action={`/mod/bucket/${b.slug}/ban`} class="inline"><input type="hidden" name="csrf" value={user.csrf} /><input type="text" name="reason" placeholder="reason" maxlength={120} required /> <button class="btn secondary">ban</button></form>
                )}
                {!b.curated && !b.banned ? <form method="post" action={`/mod/bucket/${b.slug}/curate`} class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button class="btn secondary">promote</button></form> : null}
              </td>
            </tr>
          ))}
        </table>

        <h3>Denylist</h3>
        <p class="muted">Terms added here apply on the next scan. <code>slur</code> rejects in titles/tags and flags in bodies; <code>spam</code> flags; <code>domain</code> rejects links to that host.</p>
        <form method="post" action="/mod/denylist" class="inline">
          <input type="hidden" name="csrf" value={user.csrf} />
          <input type="text" name="term" placeholder="term or domain" required maxlength={80} />
          <select name="kind"><option value="slur">slur</option><option value="spam">spam</option><option value="domain">domain</option></select>
          <button class="btn secondary">add</button>
        </form>
        <table class="list"><tr><th>term</th><th>kind</th><th>by</th><th></th></tr>
          {deny.map((d) => <tr><td>{d.term}</td><td>{d.kind}</td><td class="muted">{d.added_by}</td><td><form method="post" action="/mod/denylist/remove" class="inline"><input type="hidden" name="csrf" value={user.csrf} /><input type="hidden" name="term" value={d.term} /><button class="link">remove</button></form></td></tr>)}
        </table>
      </section>
    </Layout>,
  );
});

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
