// Takedown requests for trawled listings (repos that never opted in). No login needed: the owner may not be able to log in.
// No model reads the message, and the requester only ever sees canned replies. A trawled listing comes down immediately,
// up to TAKEDOWN_AUTO_PER_DAY a day site-wide; beyond that, requests queue for a human. The message stays in the mod console.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getRepo, rateLimit, logAction } from "../lib/db";
import { body, wantsJson } from "../middleware";
import { ipHash } from "../lib/trust";
import { validateTakedown, retireTrawled } from "../lib/virtual";
import { notify } from "./contact";
import { Layout } from "../views/layout";

export const takedown = new Hono<AppEnv>();

const CANNED = {
  removed: "Removed. It won't be re-added: we kept only the repo's name so the trawl never brings it back. Sorry for the bother.",
  queued: "Received. A human will look at it within a few days. Nothing else happens automatically.",
  opted: "This repo opted in on its own: its owner committed a slopscore.md. The owner can remove it from its page after logging in with GitHub, or by deleting the file. For legal notices, use the contact page.",
} as const;
type Outcome = keyof typeof CANNED;

takedown.get("/:owner/:name/takedown", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  const doneRaw = c.req.query("done");
  // Own keys only: ?done=constructor must not print a function's source as a notice.
  const done = doneRaw && Object.hasOwn(CANNED, doneRaw) ? (doneRaw as Outcome) : undefined;
  const error = c.req.query("error");
  const name = r?.full_name ?? `${c.req.param("owner")}/${c.req.param("name")}`;
  return c.html(
    <Layout meta={{ title: `Takedown · ${name} — SlopScore`, noindex: true }} user={user} url={url}>
      <section class="wrap narrow" style="padding:0">
        <h2>Takedown request</h2>
        {done ? <div class="notice">{CANNED[done]}</div> : null}
        {error ? <div class="notice">{error}</div> : null}
        {!r ? <p>Nothing is listed as <code>{name}</code>, so there's nothing to take down.</p>
          : r.source !== "trawl" ? <p>{CANNED.opted} <a href="/contact">Contact</a>.</p>
          : r.status === "delisted" ? (done ? null : <p>{CANNED.removed}</p>)
          : (
            <>
              <p><a href={`/r/${r.full_name}`}>{r.full_name}</a> was listed by the Cap'm's trawl; its owner never submitted it. If you'd like it gone, say so below. A trawled listing comes down right away and never comes back.</p>
              <p class="muted">The owner can also do this in one click by logging in with GitHub as <strong>{r.owner}</strong>; there's no account to make. Your message goes only to the moderators. No AI reads it and it is never published.</p>
              <form method="post" action={`/r/${r.full_name}/takedown`} class="commentform">
                {user ? <input type="hidden" name="csrf" value={user.csrf} /> : null}
                <textarea name="message" required minlength={20} maxlength={2000} placeholder="Who you are and what you'd like removed (at least 20 characters)."></textarea>
                <p><label>Contact (optional) <input type="text" name="contact" maxlength={200} placeholder="email or GitHub login, if you want a reply" /></label></p>
                <div><button type="submit">Request takedown</button></div>
              </form>
            </>
          )}
      </section>
    </Layout>,
  );
});

takedown.post("/:owner/:name/takedown", async (c) => {
  const db = c.env.DB;
  const r = await getRepo(db, c.req.param("owner"), c.req.param("name"));
  const base = `/r/${r?.full_name ?? `${c.req.param("owner")}/${c.req.param("name")}`}/takedown`;
  const reply = (outcome: Outcome) => wantsJson(c) ? c.json({ ok: true, outcome, message: CANNED[outcome] }) : c.redirect(`${base}?done=${outcome}`);
  const refuse = (status: 400 | 404 | 429, error: string) => wantsJson(c) ? c.json({ ok: false, error }, status) : c.redirect(`${base}?error=${encodeURIComponent(error)}`);
  if (!r) return refuse(404, "Nothing is listed under that name.");
  if (r.source !== "trawl") return reply("opted");
  if (r.status === "delisted") return reply("removed");
  const b = await body(c);
  const v = validateTakedown({ message: b.message, contact: b.contact });
  if (!v.ok) return refuse(400, v.error);
  const ip = await ipHash(c.req.header("cf-connecting-ip") ?? "local", c.env.SESSION_SECRET);
  if (!(await rateLimit(db, `takedown-ip:${ip}`, 3, 86400)) || !(await rateLimit(db, `takedown:${r.id}`, 5, 86400))) {
    return refuse(429, "Too many requests today. Try again tomorrow, or use the contact page.");
  }
  const user = c.get("user");
  const who = user && b.csrf === user.csrf ? user : null; // record a login only when the form came from our own page
  const auto = await rateLimit(db, "takedown-auto", Number(c.env.TAKEDOWN_AUTO_PER_DAY || 20), 86400);
  const ins = await db.prepare("INSERT INTO takedowns (repo_id, full_name, user_id, login, contact, message, ip_hash, outcome) VALUES (?,?,?,?,?,?,?,?)")
    .bind(r.id, r.full_name, who?.id ?? null, who?.login ?? null, v.contact, v.message, ip, auto ? "delisted" : "queued").run();
  const id = Number(ins.meta.last_row_id);
  if (auto) await retireTrawled(db, r.id, "takedown");
  // The public log records that a takedown happened, never what the message said.
  await logAction(db, { actor: "system", role: "system", action: auto ? "takedown" : "takedown-queued", targetType: "repo", targetId: r.id, label: r.full_name, note: auto ? "trawled listing removed on request" : "daily automatic limit reached; queued for a human" });
  c.executionCtx.waitUntil(
    notify(c.env, { id, login: who?.login ?? "someone not logged in", subject: `takedown (${auto ? "removed" : "queued"})`, body: v.message + (v.contact ? `\n\nContact: ${v.contact}` : ""), repo: r.full_name, anchor: "td" })
      .catch((e) => console.log("takedown notify failed", (e as Error).message)),
  );
  return reply(auto ? "removed" : "queued");
});
