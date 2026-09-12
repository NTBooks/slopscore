// Contact: a login-gated form stored in D1 and shown in the mod console, plus an optional email ping through
// Cloudflare's send-email binding. The public addresses (hello@ / abuse@) are Email Routing aliases, never a real inbox.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rateLimit, logAction } from "../lib/db";
import { requireUser, body, wantsJson } from "../middleware";
import { Layout } from "../views/layout";
import { escapeHtml } from "../lib/markdown";

export const contact = new Hono<AppEnv>();

const SUBJECTS = ["question", "bug", "feature idea", "my listing", "press", "other"];

contact.get("/", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const flash = c.req.query("sent") ? "Sent. It's in the mod console; expect a reply on GitHub or by email if you asked for one." : null;
  const repo = c.req.query("repo") ?? "";
  return c.html(
    <Layout meta={{ title: "Contact — SlopScupper", description: "Talk to the humans behind the trough." }} user={user} url={url}>
      <section class="wrap narrow" style="padding:0">
        <h2>Contact</h2>
        {flash ? <div class="notice">{flash}</div> : null}
        <p>Questions, bugs, ideas, or something about your listing: use the form. It needs a GitHub login so we know who's talking and so bots don't. Messages land in the moderators' console, not an inbox.</p>
        {user ? (
          <form method="post" action="/contact" class="commentform">
            <input type="hidden" name="csrf" value={user.csrf} />
            <p><label>Subject <select name="subject">{SUBJECTS.map((s) => <option value={s}>{s}</option>)}</select></label>
              {" "}<label>About a repo <input type="text" name="repo" placeholder="owner/name (optional)" value={repo} maxlength={140} /></label></p>
            <textarea name="body" required maxlength={4000} placeholder="What's up? Markdown is fine. Include an email if you want a reply there; otherwise we answer on GitHub."></textarea>
            <div><button type="submit">Send</button></div>
          </form>
        ) : <p class="notice"><a href="/auth/github?next=/contact">Log in with GitHub</a> to send a message.</p>}
        <h3>Legal and abuse</h3>
        <p>Is your repo on SlopScupper with a "paperwork by the Cap'm" chip, and you can't log in as its owner? Use the <em>request a takedown</em> link on its page. No login is needed and it comes down right away.</p>
        <p>DMCA notices, other takedown requests, and anything a lawyer wrote: <a href={`mailto:${c.env.ABUSE_EMAIL ?? "abuse@slopscore.org"}`}>{c.env.ABUSE_EMAIL ?? "abuse@slopscore.org"}</a>. Everything else: <a href={`mailto:${c.env.CONTACT_EMAIL ?? "hello@slopscore.org"}`}>{c.env.CONTACT_EMAIL ?? "hello@slopscore.org"}</a>. Both are aliases that can be rotated, so the form above is the reliable path.</p>
        <p class="muted">Reporting a specific listing or comment? Use the muted <em>report</em> link next to it instead; that goes straight to the queue.</p>
      </section>
    </Layout>,
  );
});

contact.post("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const text = (b.body ?? "").trim();
  const subject = SUBJECTS.includes(b.subject) ? b.subject : "other";
  const repo = (b.repo ?? "").trim().slice(0, 140) || null;
  if (!text || text.length > 4000) return c.json({ error: "body must be 1–4000 chars" }, 400);
  if ((text.match(/https?:\/\//g) ?? []).length > 5) return c.json({ error: "too many links" }, 400);
  if (!(await rateLimit(c.env.DB, `contact:${user.id}`, 3, 3600))) return c.json({ error: "three messages an hour is plenty" }, 429);
  const ins = await c.env.DB.prepare("INSERT INTO messages (user_id, login, subject, body, repo_full_name) VALUES (?,?,?,?,?)").bind(user.id, user.login, subject, text, repo).run();
  const id = Number(ins.meta.last_row_id);
  c.executionCtx.waitUntil(notify(c.env, { id, login: user.login, subject, body: text, repo }).catch((e) => console.log("contact notify failed", (e as Error).message)));
  if (wantsJson(c)) return c.json({ ok: true, id }, 201);
  return c.redirect("/contact?sent=1");
});

/** Optional email ping via Cloudflare's send-email binding. Needs the MAIL binding + CONTACT_NOTIFY (a verified Email Routing destination). */
export async function notify(env: AppEnv["Bindings"], m: { id: number; login: string; subject: string; body: string; repo: string | null; anchor?: string }): Promise<void> {
  if (!env.MAIL || !env.CONTACT_NOTIFY) return;
  const from = env.CONTACT_FROM ?? "schnitzel@slopscore.org";
  const site = env.SITE_URL ?? "https://slopscore.org";
  const subject = `[SlopScupper] ${m.subject} from ${m.login}${m.repo ? ` about ${m.repo}` : ""}`;
  const text = `${m.body}\n\n---\nFrom: ${m.anchor ? m.login : `github.com/${m.login}`}${m.repo ? `\nRepo: ${site}/r/${m.repo}` : ""}\n${m.anchor ? "Takedown" : "Message"} #${m.id}: ${site}/mod#${m.anchor ?? "msg"}${m.id}\nReplying to this email goes nowhere; answer on GitHub or by the address they gave.`;
  const raw = [
    `From: Schnitzel <${from}>`,
    `To: ${env.CONTACT_NOTIFY}`,
    `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <msg-${m.id}-${Date.now()}@slopscore.org>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAIL.send(new EmailMessage(from, env.CONTACT_NOTIFY, raw));
}

export { escapeHtml as _e };
