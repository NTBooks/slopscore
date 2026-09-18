// Admin console: report queue, quarantine bucket, held comments, bans, buckets, denylist. Every action lands in the public log.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { allBuckets, logAction, getRepoById, type RepoRow } from "../lib/db";
import { requireUser, body, wantsJson } from "../middleware";
import { Layout } from "../views/layout";
import { ago, isoDate, now } from "../lib/time";
import { GitHub } from "../lib/github";
import { scanRepo, removedReasonLabel } from "../lib/scan";
import { flagsSnapshot, ALL_FLAGS } from "../lib/flags";
import { crawlClock, parseManual, JOBS, MANUAL_COOLDOWN, type Job } from "../lib/crawlclock";
import { CrawlClockBox } from "../views/crawlclock";
import { sweep } from "../jobs/sweep";
import { scanQueue } from "../jobs/scan";
import { recrawl } from "../jobs/recrawl";
import { soundSea } from "../jobs/seen";
import { getState, setState } from "../jobs/stats";
import { retireTrawled, relistTrawled } from "../lib/virtual";
import { addToBacklog, releaseBacklog, trawlDaily, HOURLY_TRAWL, type CuratedInput } from "../jobs/trawl";
import { counts as tripCounts, BLOCK_SECONDS } from "../lib/tripwire";
import { STATIC_TOOLS, allTools, loadToolRows, upsertToolRow, validateToolInput, type ToolRow } from "../lib/tools";
import { cleanReason } from "../lib/virtual";
import { parseJson } from "../lib/db";
import { SCOUT_MIN, SIGHTING_DAYS } from "../jobs/scout";

export const mod = new Hono<AppEnv>();

mod.use("*", async (c, next) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "login required", login: "/auth/github?next=/mod" }, 401);
  if (!u.isAdmin) return c.json({ error: "admins only" }, 403);
  await next();
});

const FLAG_HELP: Record<string, string> = {
  weight: "votes carry a trust weight from GitHub account age/repos/followers; off = every vote weighs 1",
  ring: "bursts from same-week accounts or one network are stored with weight 0 and flagged",
  burst: "votes per hour beyond max(10, half the visitors) weigh 0 and are flagged",
  crowd: "anonymous crowd votes accepted and shown beside the score (never ranking)",
  fuzz: "displayed scores above 20 jittered ±2% so bots can't observe their own vote",
  guard: "comments pass through Llama Guard; flagged ones are held here",
  risk: "risk score at or above RISK_QUARANTINE sends a repo to quarantine",
  tripwire: "requests shaped like an attack are counted, and one email a day goes out",
  tripblock: "three targeted probes in a day shut that source out for 24 hours; SQL and traversal shapes only, never a verified crawler or an admin, and /contact still answers",
  critics: "the disclosed critics read and vote at all; off = no model calls from the cast, every verdict already written stays",
  rising: "the rising sort is on offer: a tab, a chip, and ?sort=rising",
  controversial: "the controversial sort is on offer: a tab, a chip, and ?sort=controversial",
  updated: "the updated sort is on offer: a tab, a chip, and ?sort=updated",
  upcoming: "the /upcoming feed is on offer: a tab and ?sort=upcoming",
};

interface ReportRow { id: number; target_type: "repo" | "comment"; target_id: number; reason: string; note: string | null; created_at: number; reporter: string; label: string | null; status: string | null; body: string | null; author: string | null }

mod.get("/", async (c) => {
  const user = c.get("user")!; const url = new URL(c.req.url);
  const db = c.env.DB;
  const flash = c.req.query("flash");
  const clock = await crawlClock(db);
  const messages = await db.prepare("SELECT id, login, subject, body, repo_full_name, created_at, read_at, reply FROM messages WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100").all<{ id: number; login: string; subject: string; body: string; repo_full_name: string | null; created_at: number; read_at: number | null; reply: string | null }>().then((r) => r.results ?? []);
  const backlog = await db.prepare("SELECT sum(CASE WHEN released_at IS NULL THEN 1 ELSE 0 END) AS waiting, sum(CASE WHEN outcome = 'queued' THEN 1 ELSE 0 END) AS released, sum(CASE WHEN outcome LIKE 'skipped:%' THEN 1 ELSE 0 END) AS refused FROM trawl_backlog").first<{ waiting: number | null; released: number | null; refused: number | null }>();
  const today = new Date().toISOString().slice(0, 10);
  const [trip, blocks] = await Promise.all([
    tripCounts(db, today),
    db.prepare("SELECT ip_hash, until, kind, hits, at FROM tripwire_blocks WHERE until > ? ORDER BY at DESC LIMIT 50").bind(now())
      .all<{ ip_hash: string; until: number; kind: string; hits: number; at: number }>().then((r) => r.results ?? []),
  ]);
  const trend = await db.prepare(
    "SELECT day, sum(CASE WHEN severity = 'targeted' THEN n ELSE 0 END) AS targeted, sum(CASE WHEN severity != 'targeted' THEN n ELSE 0 END) AS noise FROM tripwire GROUP BY day ORDER BY day DESC LIMIT 14",
  ).all<{ day: string; targeted: number; noise: number }>().then((r) => r.results ?? []);
  const takedowns = await db.prepare("SELECT t.id, t.full_name, t.login, t.contact, t.message, t.outcome, t.settle_at, t.created_at, r.status FROM takedowns t LEFT JOIN repos r ON r.id = t.repo_id WHERE t.resolved_at IS NULL ORDER BY t.created_at DESC LIMIT 100").all<{ id: number; full_name: string; login: string | null; contact: string | null; message: string; outcome: string; settle_at: number | null; created_at: number; status: string | null }>().then((r) => r.results ?? []);
  const [reports, quarantined, hidden, delisted, held, banned, buckets, deny, candidates, toolRows] = await Promise.all([
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
    db.prepare("SELECT * FROM repos WHERE status = 'delisted' ORDER BY removed_at DESC, id DESC LIMIT 50").all<RepoRow>().then((r) => r.results ?? []),
    db.prepare("SELECT c.id, c.body_md, c.held_reason, c.created_at, u.login, r.full_name FROM comments c JOIN users u ON u.id = c.user_id JOIN repos r ON r.id = c.repo_id WHERE c.hidden_at IS NOT NULL AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 100").all<{ id: number; body_md: string; held_reason: string | null; created_at: number; login: string; full_name: string }>().then((r) => r.results ?? []),
    db.prepare("SELECT id, login, banned_at, ban_reason FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC LIMIT 100").all<{ id: number; login: string; banned_at: number; ban_reason: string | null }>().then((r) => r.results ?? []),
    allBuckets(db),
    db.prepare("SELECT term, kind, scope, added_by, created_at FROM denylist ORDER BY created_at DESC").all<{ term: string; kind: string; scope: string; added_by: string | null; created_at: number }>().then((r) => r.results ?? []),
    db.prepare("SELECT term, n, kinds, samples, first_seen, last_seen FROM tool_candidates WHERE status = 'open' ORDER BY n DESC, last_seen DESC LIMIT 50").all<{ term: string; n: number; kinds: string; samples: string; first_seen: number; last_seen: number }>().then((r) => r.results ?? []),
    loadToolRows(db),
  ]);
  const toolKeys = allTools(toolRows).map((t) => t.key);
  // group reports by target
  const groups = new Map<string, ReportRow[]>();
  for (const r of reports) { const k = `${r.target_type}:${r.target_id}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const csrf = <input type="hidden" name="csrf" value={user.csrf} />;
  const act = (action: string, label: string, url: string, cls = "btn secondary", confirm?: string) => (
    <form method="post" action={url} class="inline" data-confirm={confirm}>{csrf}<button class={cls} name="action" value={action}>{label}</button></form>
  );

  return c.html(
    <Layout meta={{ title: "Mod — SlopScore", noindex: true }} user={user} url={url}>
      <section class="wrap narrow" style="padding:0">
        <h2>Mod console</h2>
        <p class="muted">Every action here lands in the <a href="/log">public log</a> with your login. Nothing here is a secret.</p>
        {flash ? <div class="notice">{flash}</div> : null}
        <h3>Crawler</h3>
        <CrawlClockBox clock={clock} user={user} back="/mod" />
        <div class="capacity free" style="margin:8px 0">
          <div style="grid-column:1/-1"><span class="label">feature flags · MOD_FLAGS var, deploy to change</span>
            {ALL_FLAGS.map((f) => <span class={`chip ${flagsSnapshot()[f] ? "ok" : "bad"}`} title={FLAG_HELP[f]}>{f}: {flagsSnapshot()[f] ? "on" : "off"}</span>)}
            <span class="muted small"> · weight = trust-weighted votes · ring = vote-ring zeroing · burst = votes capped by visitors · crowd = anonymous votes shown · fuzz = displayed score jitter · guard = Llama Guard on comments · risk = quarantine by risk score · tripwire = probe counting and the daily email · tripblock = three targeted probes in a day cost that source 24 hours · rising/controversial/updated/upcoming = that feed sort is on offer</span>
          </div>
        </div>

        <h3>Tripwire <span class="muted">· {trip.targeted} targeted, {trip.noise} noise today</span></h3>
        <p class="muted small">
          Requests shaped like an attack (src/lib/tripwire.ts). <strong>Targeted</strong> means nobody's accident:
          SQL tautologies, our own &lt;repo&gt; prompt delimiter in a query string, path traversal. <strong>Noise</strong>
          is the background radiation of the public internet — .env probes, wp-admin, a crawler following a mangled
          link — and never blocks anyone or sends mail. A source is shut out only after three targeted hits in a day, only for SQL and traversal shapes, and /contact still answers it. If the source count climbs, turn on Bot Fight Mode
          (Cloudflare → slopscore.org → Security → Bots). One email a day at most, whatever arrives.
        </p>
        <div class={`capacity ${trip.targeted ? "paid" : "free"}`} style="margin:8px 0">
          <div><span class="label">targeted today</span>{trip.targeted}</div>
          <div><span class="label">noise today</span>{trip.noise}</div>
          <div><span class="label">distinct sources</span>{trip.ips}</div>
          <div><span class="label">busiest source</span>{trip.worst} hits</div>
          <div><span class="label">shut out now</span>{blocks.length}{blocks.length === 50 ? "+" : ""}</div>
        </div>
        {trip.byKind.length ? (
          <table class="grid small">
            <thead><tr><th>kind</th><th>severity</th><th>today</th><th>last</th><th>most recent sample</th></tr></thead>
            <tbody>
              {trip.byKind.map((k) => (
                <tr>
                  <td><code>{k.kind}</code></td>
                  <td><span class={`chip ${k.severity === "targeted" ? "bad" : ""}`}>{k.severity}</span></td>
                  <td>{k.n}</td>
                  <td class="muted">{ago(k.last_at)}</td>
                  <td class="muted"><code>{k.sample ?? ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div class="empty">Nothing tripped today. Quiet out there.</div>}
        {blocks.length ? (
          <details style="margin:8px 0">
            <summary>Shut out right now · {blocks.length}</summary>
            <p class="muted small">
              {BLOCK_SECONDS / 3600} hours from the probe. The hash is the salted digest the vote ring-detector
              uses (no address is stored, and rotating SESSION_SECRET voids every row). Expired rows are swept
              at 00:05. Somebody caught by mistake can ask on /contact.
            </p>
            <table class="grid small">
              <thead><tr><th>source</th><th>why</th><th>hits</th><th>since</th><th>until</th></tr></thead>
              <tbody>
                {blocks.map((b) => (
                  <tr>
                    <td><code>{b.ip_hash}</code></td>
                    <td><code>{b.kind}</code></td>
                    <td>{b.hits}</td>
                    <td class="muted">{ago(b.at)}</td>
                    <td class="muted">{ago(b.until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
        {trend.length > 1 ? (
          <details style="margin:8px 0">
            <summary>Last {trend.length} days</summary>
            <table class="grid small">
              <thead><tr><th>day</th><th>targeted</th><th>noise</th></tr></thead>
              <tbody>{trend.map((d) => <tr><td>{d.day}</td><td>{d.targeted}</td><td class="muted">{d.noise}</td></tr>)}</tbody>
            </table>
          </details>
        ) : null}

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

        <h3>Messages <span class="muted">· contact form · {messages.length} open</span></h3>
        {messages.length === 0 ? <div class="empty">Nobody has written in. Suspicious.</div> : null}
        {messages.map((m) => (
          <div class="modcard" id={`msg${m.id}`}>
            <div><strong>{m.subject}</strong> from <a href={`/u/${m.login}`}>{m.login}</a>{m.repo_full_name ? <> about <a href={`/r/${m.repo_full_name}`}>{m.repo_full_name}</a></> : null} · {ago(m.created_at)}{m.read_at ? null : <span class="chip warn"> new</span>}</div>
            <blockquote>{m.body}</blockquote>
            <div class="actions">
              <form method="post" action={`/mod/message/${m.id}`} class="inline">{csrf}<input type="text" name="note" placeholder="private note (optional)" maxlength={300} /> <button class="btn secondary" name="action" value="resolve">resolve</button></form>
              {act("ban", "ban sender", `/mod/message/${m.id}`, "btn secondary", "Ban this account?")}
              <a class="muted" href={`https://github.com/${m.login}`} target="_blank" rel="noopener">reply on GitHub ↗</a>
            </div>
          </div>
        ))}

        <h3 id="backlog">Truffle backlog <span class="muted">· hand-vetted picks · {backlog?.waiting ?? 0} waiting, {backlog?.released ?? 0} released, {backlog?.refused ?? 0} refused</span></h3>
        <p class="muted small">The hourly trawl releases these into the scan queue first, a few at a time, up to TRAWL_PER_DAY a day. Agents POST the same JSON to <code>/mod/trawl/import</code> with an admin bearer token.</p>
        <form method="post" action="/mod/trawl/import" class="commentform">{csrf}
          <textarea name="picks" placeholder='[{"repo": "owner/name", "reason": "its README says it was vibe coded with Claude Code"}]'></textarea>
          <div><label>release now <input type="number" name="release_now" value="0" min="0" max="50" style="width:5em" /></label> <button class="btn secondary">add to backlog</button></div>
        </form>
        <form method="post" action="/mod/trawl/release" class="inline">{csrf}<input type="number" name="n" value="10" min="1" max="50" style="width:5em" /> <button class="btn secondary">release from backlog now</button></form>

        <h3 id="scout">The scout's log <span class="muted">· tool names the trawl did not know · {candidates.length} to decide</span></h3>
        <p class="muted small">Each is a name {SCOUT_MIN} or more repos credited in the last {SIGHTING_DAYS} days that the registry does not know. <strong>Approving takes effect at once</strong>: the trawl searches for it from the next hour, it is credited and counted on every chart, and it is listed with today's date on <a href="/method">/method</a>. Merge it into a tool you already know when it is the same thing under another name. Dismissed names keep being counted but never surface again. Agents can POST the same fields to <code>/mod/tool/approve</code> with an admin bearer token.</p>
        {candidates.length === 0 ? <div class="empty">Nothing the registry does not already know.</div> : null}
        {candidates.map((t) => {
          const samples = parseJson<string[]>(t.samples, []);
          const kinds = parseJson<string[]>(t.kinds, []);
          const words = t.term.replace(/-/g, " ");
          const name = words.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
          return (
            <div class="modcard" id={`scout-${t.term}`}>
              <div><strong>{t.term}</strong> · {t.n} repos · {kinds.map((k) => <span class="chip">{k}</span>)} · first seen {ago(t.first_seen)} · {samples.map((s, i) => <>{i ? ", " : ""}<a href={`https://github.com/${s}`} target="_blank" rel="noopener">{s}</a></>)}</div>
              <form method="post" action="/mod/tool/approve" class="commentform">{csrf}<input type="hidden" name="term" value={t.term} />
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:12px">
                  <label>key <input type="text" name="key" value={t.term} maxlength={40} required /></label>
                  <label>name <input type="text" name="name" value={name} maxlength={40} required /></label>
                  <label>aliases <input type="text" name="aliases" value={words} title="comma-separated words a claim may use" /></label>
                  <label>claim topics <input type="text" name="claim_topics" value={`built-with-${t.term}`} title="comma-separated topics that ARE a claim; each is also a search" /></label>
                  <label>credit topics <input type="text" name="topics" value={`${t.term}, built-with-${t.term}`} title="comma-separated topics that credit the tool" /></label>
                  <label>phrases <input type="text" name="phrases" value={`"built with ${words}" in:description`} title="comma-separated GitHub searches" /></label>
                  <label style="grid-column:1 / -1">note <input type="text" name="note" placeholder="what it is, for /method (10 to 280 characters)" maxlength={280} /></label>
                </div>
                <div><button class="btn">approve</button></div>
              </form>
              <div class="actions">
                <form method="post" action="/mod/tool/merge" class="inline">{csrf}<input type="hidden" name="term" value={t.term} /><select name="into">{toolKeys.map((k) => <option value={k}>{k}</option>)}</select> <button class="btn secondary">merge into</button></form>
                <form method="post" action="/mod/tool/dismiss" class="inline">{csrf}<input type="hidden" name="term" value={t.term} /><button class="btn secondary">dismiss</button></form>
              </div>
            </div>
          );
        })}
        {toolRows.length ? (
          <>
            <h4>Approved tools</h4>
            <table class="list"><tr><th>key</th><th>name</th><th>aliases</th><th>topics</th><th>by</th><th>when</th><th></th></tr>
              {toolRows.map((r) => (
                <tr>
                  <td>{r.key}{STATIC_TOOLS.some((s) => s.key === r.key) ? <span class="muted"> (widens a frozen tool)</span> : null}</td><td>{r.name}</td>
                  <td class="muted">{r.aliases.join(", ")}</td><td class="muted">{[...new Set([...r.claim_topics, ...r.topics])].join(", ")}</td>
                  <td class="muted">{r.approved_by}</td><td class="muted">{isoDate(r.approved_at)}{r.retired_at ? ` · retired ${isoDate(r.retired_at)}` : ""}</td>
                  <td>{r.retired_at ? null : <form method="post" action="/mod/tool/retire" class="inline" data-confirm={`Retire ${r.key}? The trawl stops searching for it and the claim gate stops accepting it. Listings that already credit it keep the credit.`}>{csrf}<input type="hidden" name="key" value={r.key} /><button class="link">retire</button></form>}</td>
                </tr>
              ))}
            </table>
          </>
        ) : null}

        <h3 id="takedowns">Takedowns <span class="muted">· trawled listings · {takedowns.length} open</span></h3>
        {takedowns.length === 0 ? <div class="empty">No takedown requests.</div> : null}
        {takedowns.map((t) => (
          <div class="modcard" id={`td${t.id}`}>
            <div>
              <a href={`/r/${t.full_name}`}>{t.full_name}</a> ·{" "}
              {t.outcome === "hidden" ? <span class="chip warn">hidden · removed for good on {t.settle_at ? isoDate(t.settle_at) : "the next settle"}</span>
                : t.outcome === "delisted" ? <span class="chip ok">removed</span>
                : <span class="chip warn">queued: daily limit hit</span>}
              {" "}· from {t.login ? <a href={`/u/${t.login}`}>{t.login}</a> : "someone not logged in"}{t.contact ? <> · contact: {t.contact}</> : null} · {ago(t.created_at)}
            </div>
            <blockquote>{t.message}</blockquote>
            <div class="actions">
              {t.status !== "delisted" ? act("apply", "remove now", `/mod/takedown/${t.id}`, "btn", "Remove for good? This cannot be undone.") : null}
              {t.outcome === "hidden" && t.status === "hidden" ? act("restore", "restore the listing", `/mod/takedown/${t.id}`) : null}
              {act("resolve", "resolve", `/mod/takedown/${t.id}`)}
            </div>
          </div>
        ))}

        <h3>Quarantined <span class="muted">· awaiting a human · {quarantined.length}</span></h3>
        {quarantined.length === 0 ? <div class="empty">Nobody is in quarantine.</div> : null}
        {quarantined.map((r) => <RepoCard r={r} csrf={csrf} act={act} kind="quarantined" />)}

        <h3>Hidden by reports <span class="muted">· {hidden.length}</span></h3>
        {hidden.length === 0 ? <div class="empty">Nothing hidden.</div> : null}
        {hidden.map((r) => <RepoCard r={r} csrf={csrf} act={act} kind="hidden" />)}

        <h3>Delisted <span class="muted">· newest first · {delisted.length}{delisted.length === 50 ? "+" : ""}</span></h3>
        <p class="muted small">Removed by the crawler (gone from GitHub, marker deleted, DMCA), by the owner, or by a moderator. Each one is in the <a href="/log">public log</a> with its reason. Restore relists it and clears any lock; rescan asks GitHub again first.</p>
        {delisted.length === 0 ? <div class="empty">Nothing delisted.</div> : null}
        {delisted.map((r) => (
          <div class="modcard">
            <div><strong><a href={`/r/${r.full_name}`}>{r.full_name}</a></strong> {r.tagline ? <span class="muted">— {r.tagline}</span> : null} · <span class={`chip ${r.removed_reason === "admin" ? "warn" : "bad"}`}>{removedReasonLabel(r.removed_reason)}</span> · removed {r.removed_at ? ago(r.removed_at) : "at an unknown time"}{r.source === "trawl" ? " · trawled" : ""}{r.locked_by ? ` · locked by ${r.locked_by}` : ""}{r.mod_note ? <span class="muted"> · {r.mod_note}</span> : null}</div>
            <div class="actions">
              {act("rescan", "rescan", `/mod/repo/${r.id}`)}
              {act("restore", "restore (list)", `/mod/repo/${r.id}`, "btn secondary", r.removed_reason === "owner-request" ? "The owner asked for this removal. Relist it anyway?" : "Relist it? The next recrawl still delists it if it is gone from GitHub.")}
            </div>
          </div>
        ))}

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

mod.post("/message/:id", requireUser, async (c) => {
  const id = Number(c.req.param("id"));
  const b = await body(c);
  const admin = c.get("user")!.login;
  const db = c.env.DB;
  const m = await db.prepare("SELECT id, user_id, login FROM messages WHERE id = ?").bind(id).first<{ id: number; user_id: number; login: string }>();
  if (!m) return c.json({ error: "unknown message" }, 404);
  if (b.action === "ban") {
    await db.prepare("UPDATE users SET banned_at = unixepoch(), ban_reason = 'contact form abuse' WHERE id = ?").bind(m.user_id).run();
    await logAction(db, { actor: admin, role: "admin", action: "ban", targetType: "user", targetId: m.user_id, label: m.login, note: "contact form abuse" });
  }
  await db.prepare("UPDATE messages SET resolved_at = unixepoch(), resolved_by = ?, read_at = COALESCE(read_at, unixepoch()), reply = ? WHERE id = ?").bind(admin, (b.note ?? "").slice(0, 300) || null, id).run();
  // messages are private; the public log only records that one was handled, never the content
  await logAction(db, { actor: admin, role: "admin", action: "message-resolved", targetType: "message", targetId: id });
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod");
});

// ---- truffle backlog: hand-vetted picks, posted as JSON by an agent holding an admin bearer, or pasted in the form above ----
mod.post("/trawl/import", requireUser, async (c) => {
  const admin = c.get("user")!.login;
  let picks: unknown;
  let releaseNow = 0;
  if ((c.req.header("content-type") ?? "").includes("application/json")) {
    const j = (await c.req.json().catch(() => ({}))) as { picks?: unknown; release_now?: unknown };
    picks = j.picks; releaseNow = Number(j.release_now ?? 0);
  } else {
    const b = await body(c);
    try { picks = JSON.parse(b.picks || "[]"); } catch { return c.json({ error: "picks must be a JSON array of {repo, reason}" }, 400); }
    releaseNow = Number(b.release_now || 0);
  }
  if (!Array.isArray(picks)) return c.json({ error: "picks must be an array of {repo, reason}" }, 400);
  const added = await addToBacklog(c.env, picks as CuratedInput[], admin);
  const released = releaseNow > 0 ? await releaseBacklog(c.env, releaseNow) : null;
  const msg = `Backlog: ${added.added.length} added, ${added.duplicate.length} already known, ${added.invalid.length} invalid.${released ? ` Released ${released.queued.length} into the queue, refused ${released.skipped.length}; ${released.left} waiting.` : ""}`;
  await logAction(c.env.DB, { actor: admin, role: "admin", action: "trawl-import", targetType: "crawler", targetId: 0, label: "backlog", note: msg });
  return wantsJson(c) ? c.json({ ...added, released }) : c.redirect(`/mod?flash=${encodeURIComponent(msg)}#backlog`);
});

mod.post("/trawl/release", requireUser, async (c) => {
  const admin = c.get("user")!.login;
  const ct = c.req.header("content-type") ?? "";
  const n = ct.includes("application/json") ? Number(((await c.req.json().catch(() => ({}))) as { n?: unknown }).n ?? 10) : Number((await body(c)).n || 10);
  const res = await releaseBacklog(c.env, n);
  const msg = `Released ${res.queued.length} into the queue, refused ${res.skipped.length}; ${res.left} waiting.${res.note ? ` ${res.note}.` : ""}`;
  await logAction(c.env.DB, { actor: admin, role: "admin", action: "trawl-release", targetType: "crawler", targetId: 0, label: "backlog", note: msg });
  return wantsJson(c) ? c.json(res) : c.redirect(`/mod?flash=${encodeURIComponent(msg)}#backlog`);
});

mod.get("/trawl/backlog", async (c) => {
  const rows = await c.env.DB.prepare("SELECT display_name AS repo, reason, added_by, added_at, released_at, outcome FROM trawl_backlog ORDER BY added_at DESC LIMIT 1000").all();
  return c.json({ backlog: rows.results ?? [] });
});

mod.post("/takedown/:id", requireUser, async (c) => {
  const id = Number(c.req.param("id"));
  const b = await body(c);
  const admin = c.get("user")!.login;
  const db = c.env.DB;
  const t = await db.prepare("SELECT id, repo_id, full_name FROM takedowns WHERE id = ?").bind(id).first<{ id: number; repo_id: number | null; full_name: string }>();
  if (!t) return c.json({ error: "unknown takedown" }, 404);
  let outcome: string | null = null;
  if (b.action === "apply" && t.repo_id != null) {
    await retireTrawled(db, t.repo_id, "takedown");
    outcome = "delisted";
    await logAction(db, { actor: admin, role: "admin", action: "takedown", targetType: "repo", targetId: t.repo_id, label: t.full_name, note: "trawled listing removed on request" });
  } else if (b.action === "restore" && t.repo_id != null) {
    // The undo the grace period exists for. Only a listing hidden by a takedown comes back this way.
    if (await relistTrawled(db, t.repo_id)) await logAction(db, { actor: admin, role: "admin", action: "takedown-restored", targetType: "repo", targetId: t.repo_id, label: t.full_name, note: "takedown declined; listing restored" });
  }
  // the message stays private; the log only records that the request was handled
  await db.prepare("UPDATE takedowns SET outcome = COALESCE(?, outcome), resolved_at = unixepoch(), resolved_by = ?, note = ? WHERE id = ?").bind(outcome, admin, (b.note ?? "").slice(0, 300) || null, id).run();
  return wantsJson(c) ? c.json({ ok: true }) : c.redirect("/mod#takedowns");
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

// ---- crawler: run a job now instead of waiting for its cron ----
const RUN: Record<Job, (env: AppEnv["Bindings"]) => Promise<string>> = {
  sweep: async (env) => {
    const r = await sweep(env);
    return r.note ? `Sweep skipped: ${r.note}.` : `Sweep searched ${r.pages} page(s) of GitHub code search and found ${r.found} new repo(s)${r.promoted ? `, and moved ${r.promoted} trawled repo(s) to the free line: the owner committed the file` : ""}.`;
  },
  scan: async (env) => {
    const r = await scanQueue(env);
    const lanes = [`${r.scanned} in the free line${r.deferred ? `, ${r.deferred} waiting on budget` : ""}`, r.trawl.note ?? `${r.trawl.scanned} trawled (our OpenRouter bill)`];
    const seen = [...r.results, ...r.trawl.results];
    return `Scan tick: ${lanes.join(" · ")}${seen.length ? `: ${seen.map((x) => `${x.repo} ${x.status}`).join(", ")}` : ""}.`;
  },
  recrawl: async (env) => {
    const r = await recrawl(env);
    const gone = r.removed.length ? ` Delisted: ${r.removed.map((x) => `${x.full_name} (${removedReasonLabel(x.reason)})`).join(", ")}.` : "";
    return `Recrawl checked ${r.checked}: ${r.rescanned} rescanned, ${r.unchanged} unchanged, ${r.delisted} delisted${r.renamed ? `, ${r.renamed} renamed` : ""}${r.revived ? `, ${r.revived} revived` : ""}.${gone}`;
  },
  trawl: async (env) => {
    // One hourly slice, exactly what the cron would do: leased, budgeted against the day, and no more.
    const r = await trawlDaily(env, HOURLY_TRAWL);
    if (r.note) return `Trawl: ${r.note}.`;
    return `Trawl landed ${r.queued.length}${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}${r.chase ? `; ${r.chase}` : ""}.`;
  },
  seen: async (env) => {
    // One sounding, exactly what the ten-minute tick would do: leased, capped against the day, no model.
    const r = await soundSea(env);
    if (r.note && !r.searched) return `Sounding: ${r.note}.`;
    return `Sounding made ${r.searched} search call(s) and wrote ${r.seen} sighting(s)${r.note ? `; ${r.note}` : ""}.`;
  },
};

mod.post("/crawl", requireUser, async (c) => {
  const b = await body(c);
  const admin = c.get("user")!.login;
  const db = c.env.DB;
  const back = b.back === "/queue" ? "/queue" : "/mod";
  const jobs: Job[] = b.action === "all" ? [...JOBS] : JOBS.filter((j) => j === b.action);
  if (!jobs.length) return c.json({ error: `unknown job; use ${JOBS.join(", ")} or all` }, 400);
  const msgs: string[] = [];
  for (const job of jobs) {
    const t = now();
    const last = parseManual(await getState(db, `${job}:manual`));
    if (last && t - last.at < MANUAL_COOLDOWN) { msgs.push(`${job}: ${last.by} ran it ${t - last.at}s ago; try again in ${MANUAL_COOLDOWN - (t - last.at)}s.`); continue; }
    await setState(db, `${job}:manual`, `${t}|${admin}`); // before running, so a double click doesn't run it twice
    let msg: string;
    try { msg = await RUN[job](c.env); } catch (e) { msg = `${job} failed: ${(e as Error).message}`; }
    await logAction(db, { actor: admin, role: "admin", action: `run-${job}`, targetType: "crawler", targetId: 0, label: job, note: msg.slice(0, 300) });
    msgs.push(msg);
  }
  const msg = msgs.join(" ");
  return wantsJson(c) ? c.json({ ok: true, message: msg }) : c.redirect(`${back}?flash=${encodeURIComponent(msg.slice(0, 600))}#crawler`);
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

// ---- the scout's log: the tool dictionary grows here, and only here ----

const csv = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const scoutFail = (c: Context<AppEnv>, error: string) => (wantsJson(c) ? c.json({ error }, 400) : c.redirect(`/mod?flash=${encodeURIComponent(error)}#scout`));
const scoutDone = (c: Context<AppEnv>, msg: string, extra: Record<string, unknown> = {}) => (wantsJson(c) ? c.json({ ok: true, ...extra }) : c.redirect(`/mod?flash=${encodeURIComponent(msg)}#scout`));
const decide = (db: D1Database, term: string, status: "approved" | "merged" | "dismissed", by: string, into: string | null, at: number) =>
  db.prepare("UPDATE tool_candidates SET status = ?, decided_by = ?, decided_at = ?, decided_into = ? WHERE term = ?").bind(status, by, at, into, term).run();

/** Approve: a new tool, or a wider frozen one. Validated like a regex is at stake, because one is. */
mod.post("/tool/approve", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const db = c.env.DB;
  const rows = await loadToolRows(db);
  const v = validateToolInput({ key: b.key ?? "", name: b.name ?? "", aliases: csv(b.aliases), claimTopics: csv(b.claim_topics), topics: csv(b.topics), phrases: csv(b.phrases) }, allTools(rows));
  if (!v.ok) return scoutFail(c, v.error);
  const note = b.note?.trim() ? cleanReason(b.note) : null;
  if (b.note?.trim() && !note) return scoutFail(c, "the note must be plain text, 10 to 280 characters");
  const t = now();
  const how = await upsertToolRow(db, v.tool, user.login, note, t);
  const term = (b.term ?? "").trim().toLowerCase();
  if (term) await decide(db, term, "approved", user.login, v.tool.key, t);
  await logAction(db, { actor: user.login, role: "admin", action: how === "added" ? "tool-approve" : "tool-widen", targetType: "tool", targetId: 0, label: v.tool.key, note: note ?? `${v.tool.name}: ${v.tool.aliases.join(", ")}` });
  return scoutDone(c, `${v.tool.key} ${how}: the trawl searches for it from the next hour, and /method lists it from now.`, { key: v.tool.key, how });
});

/** Merge: the term is another name for a tool the registry already knows. Writes an extension row for that key. */
mod.post("/tool/merge", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const db = c.env.DB;
  const term = (b.term ?? "").trim().toLowerCase();
  const into = (b.into ?? "").trim().toLowerCase();
  const rows = await loadToolRows(db);
  const tools = allTools(rows);
  const target = tools.find((x) => x.key === into);
  if (!term || !target) return scoutFail(c, `merge needs a term and a tool the registry knows; "${into}" is not one`);
  const v = validateToolInput({ key: into, name: target.name, aliases: [term.replace(/-/g, " ")], claimTopics: [`built-with-${term}`], topics: [term, `built-with-${term}`], phrases: [] }, tools.filter((x) => x.key !== into));
  if (!v.ok) return scoutFail(c, v.error);
  const t = now();
  await upsertToolRow(db, v.tool, user.login, null, t);
  await decide(db, term, "merged", user.login, into, t);
  await logAction(db, { actor: user.login, role: "admin", action: "tool-merge", targetType: "tool", targetId: 0, label: into, note: `${term} is another name for ${into}` });
  return scoutDone(c, `${term} now counts as ${into}.`, { key: into });
});

/** Dismiss: not a tool, or not one worth counting. The scout keeps counting it and never surfaces it again. */
mod.post("/tool/dismiss", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const term = (b.term ?? "").trim().toLowerCase();
  if (!term) return scoutFail(c, "term required");
  await decide(c.env.DB, term, "dismissed", user.login, null, now());
  await logAction(c.env.DB, { actor: user.login, role: "admin", action: "tool-dismiss", targetType: "tool", targetId: 0, label: term });
  return scoutDone(c, `${term} dismissed.`);
});

/** Retire: stop searching for it and stop accepting its claim. Listings that credit it keep the credit; the row stays, dated, on /method. */
mod.post("/tool/retire", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const key = (b.key ?? "").trim().toLowerCase();
  const r = await c.env.DB.prepare("UPDATE tool_registry SET retired_at = ? WHERE key = ? AND retired_at IS NULL").bind(now(), key).run();
  if (!r.meta.changes) return scoutFail(c, `${key || "(no key)"} is not an approved tool, or is already retired`);
  await logAction(c.env.DB, { actor: user.login, role: "admin", action: "tool-retire", targetType: "tool", targetId: 0, label: key });
  return scoutDone(c, `${key} retired: no longer searched for or accepted as a claim.`);
});
