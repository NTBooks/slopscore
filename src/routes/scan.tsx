// Manual scan request: a login-gated form that runs the crawler on one repo right now, the same path the /ping trigger
// and the cron sweep use, and explains in words why the repo did or did not make it into the queue. Exists so the
// site keeps working when code search stops finding marker files.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { getRepo, rateLimit, forgiveLimit, logAction, parseJson, type RepoRow } from "../lib/db";
import { GitHub, parseRepoInput } from "../lib/github";
import { scanRepo, POLICY_LABELS, type ScanReport } from "../lib/scan";
import { isOwnerOf } from "../lib/owner";
import { requireUser, body, wantsJson } from "../middleware";
import { Layout } from "../views/layout";

export const scan = new Hono<AppEnv>();

const PER_USER = 6;          // requests per account per 10 minutes
const PER_REPO_SECS = 600;   // same key and window as /ping, so the two paths share one limit

export interface Verdict {
  /** listed · queued · rejected · quarantined · hidden · delisted · not-found · rate-limited · bad-input */
  kind: string;
  headline: string;
  detail: string;
  next: string[];
  url: string | null;
  status: RepoRow["status"] | null;
  reject_reason?: string | null;
  gates?: ScanReport["gates"];
}

/** Turns a stored repo row into a plain-language verdict. `deferred`: this very scan ran out of AI budget. `fresh`: the scan ran just now. */
export function explainRepo(r: RepoRow, deferred = false, fresh = true): Verdict {
  const url = `/r/${r.full_name}`;
  const report = parseJson<ScanReport | null>(r.scan, null);
  const gates = report?.gates;
  const when = fresh ? "Scanned just now." : "Not rescanned: this repo was checked in the last 10 minutes. This is its current state.";
  switch (r.status) {
    case "listed":
      return { kind: "listed", headline: "Listed.", detail: `${when} ${r.full_name} passed every gate and is live on the feed. It does not need to be in the queue.`, next: ["Log in as the owner and press Submit on the repo page to launch it and compete for Slop of the Day."], url, status: r.status, gates };
    case "discovered":
      return r.queue_reason === "ai-budget" || deferred
        ? { kind: "queued", headline: "In the queue, waiting on today's AI budget.", detail: `${when} The cheap gates passed, but the free AI budget for the content check is spent. It sits in the free line and is scanned at 00:00 UTC.`, next: ["Nothing to do. Check the queue for its place in line.", "In a hurry? The repo page has a jump-the-line option."], url, status: r.status, gates }
        : { kind: "queued", headline: "In the queue.", detail: `${when} It is recorded as discovered and waits for the next scan run, which is every few minutes.`, next: ["Nothing to do. Watch the queue."], url, status: r.status, gates };
    case "rejected":
      return { kind: "rejected", headline: "Rejected. It is in the queue as rejected, not listed.", detail: `${when} ${r.reject_reason ?? "A gate failed."}`, next: ["Fix the problem named above in the repo or in slopscore.md, push, then request another scan here.", "Every gate result is on the repo page under the scan report."], url, status: r.status, reject_reason: r.reject_reason, gates };
    case "quarantined":
      return { kind: "quarantined", headline: "Quarantined for a human look.", detail: `${when} The risk score (${r.risk}) is over the line: ${(report?.risk?.reasons ?? []).join("; ") || "see the scan report"}. A moderator reviews it; nothing you push changes that until they do.`, next: ["Wait for a moderator. The decision lands in the public mod log.", "If it is urgent, say so on the contact form."], url, status: r.status, gates };
    case "hidden":
      return { kind: "hidden", headline: "Hidden from feeds.", detail: `${when} It was hidden by reports or by a moderator${r.locked_by ? ` (${r.locked_by})` : ""} and stays hidden until a moderator decides. A scan cannot lift that.`, next: ["Use the contact form if you think that is wrong."], url, status: r.status, gates };
    case "delisted": {
      const why = r.removed_reason;
      const detail =
        why === "owner-request" ? "The owner removed it. A scan never re-lists an owner-removed repo." :
        why === "marker-removed" ? "slopscore.md is no longer on the default branch." :
        why === "dmca" ? "GitHub took the repo down under a DMCA notice." :
        why === "tos-block" ? "GitHub blocked the repo for a terms-of-service violation." :
        why === "404" ? "GitHub no longer serves the repo: it was deleted, made private, or renamed." :
        r.locked_by ? `A moderator (${r.locked_by}) delisted it.` : "It was delisted.";
      const next =
        why === "owner-request" ? ["The owner can press Restore on the repo page; that puts it back in the queue with votes intact."] :
        why === "marker-removed" ? ["Commit slopscore.md to the root of the default branch again, then request a scan."] :
        r.locked_by ? ["Only a moderator can lift it. Use the contact form."] : ["Once GitHub serves the repo publicly again, request a scan."];
      return { kind: "delisted", headline: "Delisted.", detail: `${when} ${detail}`, next, url, status: r.status, gates };
    }
  }
}

/** The scan produced no row: GitHub would not serve the repo, or there is no marker file. */
export function explainMissing(owner: string, name: string, error: string): Verdict {
  const gh = /GitHub returned (\d+)/.exec(error);
  if (gh) {
    const code = Number(gh[1]);
    const detail = code === 404 ? "GitHub says there is no such public repository. Either the name is wrong, the repo is private, or it was renamed." :
      code === 451 ? "GitHub has taken the repo down (DMCA)." :
      code === 403 || code === 429 ? "GitHub refused the request. The crawler's own API budget may be spent; try again in a few minutes." : `GitHub answered ${code}.`;
    return { kind: "not-found", headline: "Not added: the repo is not reachable on GitHub.", detail, next: [`Only public repos are listed. Check github.com/${owner}/${name} in a private window.`], url: null, status: null };
  }
  return { kind: "not-found", headline: "Not added: no slopscore.md.", detail: `${owner}/${name} exists, but the crawler could not read slopscore.md on the default branch (${error}).`, next: ["Commit slopscore.md to the root of the default branch, not a subfolder or another branch.", "The file is a few lines; copy it from the spec page.", "Then request a scan again."], url: null, status: null };
}

const KIND_CLASS: Record<string, string> = { listed: "listed", queued: "queued", rejected: "rejected", quarantined: "queued", hidden: "queued", delisted: "delisted", "not-found": "rejected", "rate-limited": "queued", "bad-input": "rejected" };

function Page(p: { c: Context<AppEnv>; verdict?: Verdict | null; input?: string }) {
  const { c } = p; const user = c.get("user"); const url = new URL(c.req.url);
  const v = p.verdict ?? null;
  return (
    <Layout meta={{ title: "Request a scan — SlopScore", description: "Ask the crawler to check a public GitHub repo now, and learn exactly why it was or was not queued." }} user={user} url={url}>
      <section class="wrap narrow" style="padding:0">
        <h2>Request a scan</h2>
        <p>The crawler normally finds every public repo with a <code>slopscore.md</code> on its own through GitHub code search. When that is slow or broken, this is the manual way: paste a public repo and the same scan runs right now, then tells you in words what happened and why. Same rules, same gates, same queue. Anyone logged in can ask; you do not have to own the repo.</p>
        {user ? (
          <form method="post" action="/scan" class="commentform">
            <input type="hidden" name="csrf" value={user.csrf} />
            <p><label>Repo <input type="text" name="repo" placeholder="owner/name or https://github.com/owner/name" value={p.input ?? ""} required maxlength={200} style="width:min(100%,32em)" /></label> <button type="submit">Scan now</button></p>
          </form>
        ) : <p class="notice"><a href="/auth/github?next=/scan">Log in with GitHub</a> to request a scan. Agents can <code>GET /ping/owner/repo</code> without logging in.</p>}
        {v ? (
          <div class={`status verdict ${KIND_CLASS[v.kind] ?? "queued"}`}>
            <strong>{v.headline}</strong>
            <p style="margin:4px 0">{v.detail}</p>
            {v.next.length ? <ul style="margin:4px 0 4px 18px">{v.next.map((n) => <li>{n}</li>)}</ul> : null}
            {v.url ? <p style="margin:4px 0"><a href={v.url}>Open the repo page</a>{v.status && v.status !== "listed" ? <> · <a href="/queue">see the queue</a></> : null}</p> : null}
            {v.gates?.length ? (
              <details class="scanreport"><summary>Gate by gate</summary>
                <ul>{v.gates.map((g) => <li class={g.ok ? "gate-ok" : "gate-bad"}>{g.ok ? "✓" : "✗"} <strong>{POLICY_LABELS[g.gate] ?? g.gate}</strong>{g.reasons.length ? `: ${g.reasons.join("; ")}` : ""}{g.notes?.length ? <span class="muted"> — {g.notes.join("; ")}</span> : null}</li>)}</ul>
              </details>
            ) : null}
          </div>
        ) : null}
        <h3>What the answer can be</h3>
        <ul class="muted small">
          <li><strong>Listed</strong>: live on the feed; nothing to do.</li>
          <li><strong>Queued</strong>: passed the cheap gates, waiting on the daily AI budget or the next scan run.</li>
          <li><strong>Rejected</strong>: a gate failed; the reason is spelled out and the fix is usually one line in <code>slopscore.md</code>.</li>
          <li><strong>Quarantined</strong>: the risk score wants a human; a moderator decides.</li>
          <li><strong>Not added</strong>: GitHub cannot serve the repo publicly, or it has no <code>slopscore.md</code> on the default branch.</li>
          <li><strong>Delisted or hidden</strong>: an owner, a moderator, or GitHub took it off; a scan does not override that.</li>
        </ul>
        <p class="muted small">Limits: one scan per repo every 10 minutes (shared with <code>/ping</code>), {PER_USER} requests per account every 10 minutes. Inside the 10-minute window you still get the current verdict, just not a fresh scan.</p>
      </section>
    </Layout>
  );
}

scan.get("/", (c) => c.html(<Page c={c} input={c.req.query("repo") ?? ""} />));

scan.post("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const b = await body(c);
  const input = (b.repo ?? "").trim().slice(0, 200);
  const json = wantsJson(c);
  const reply = (v: Verdict, http: 200 | 202 | 400 | 404 | 429) => json ? c.json({ ok: v.status === "listed", ...v, input }, http) : c.html(<Page c={c} verdict={v} input={input} />, http);

  const parsed = parseRepoInput(input);
  if (!parsed) return reply({ kind: "bad-input", headline: "Not added: that is not a GitHub repo.", detail: `Could not read an owner and a name out of "${input}".`, next: ["Use owner/name or a github.com URL."], url: null, status: null }, 400);
  const [owner, name] = parsed;

  if (!(await rateLimit(c.env.DB, `scan-request:${user.id}`, PER_USER, 600))) {
    return reply({ kind: "rate-limited", headline: "Slow down.", detail: `${PER_USER} scan requests per account every 10 minutes is the limit.`, next: ["Try again in a few minutes."], url: null, status: null }, 429);
  }
  if (!(await rateLimit(c.env.DB, `ping:${owner}/${name}`.toLowerCase(), 1, PER_REPO_SECS))) {
    const existing = await getRepo(c.env.DB, owner, name);
    if (existing) return reply({ ...explainRepo(existing, false, false), kind: "rate-limited" }, 200);
    return reply({ kind: "rate-limited", headline: "Not added: scanned in the last 10 minutes and nothing came of it.", detail: `${owner}/${name} was checked less than 10 minutes ago and is not in the database. That means GitHub could not serve it publicly, or it has no slopscore.md on the default branch.`, next: ["Fix that, wait for the window to pass, and request again."], url: null, status: null }, 200);
  }

  const gh = new GitHub(c.env.GITHUB_CRAWL_TOKEN);
  const res = await scanRepo(c.env.DB, c.env, gh, owner, name);
  // The per-repo window was taken before the scan ran. A scan that came back with an error did not do the
  // thing the window guards, so it is given back: the per-account limit above still bounds a retry loop.
  if ("error" in res.outcome) await forgiveLimit(c.env.DB, `ping:${owner}/${name}`.toLowerCase());
  const v = res.repo ? explainRepo(res.repo, !("error" in res.outcome) && Boolean(res.outcome.deferred)) : explainMissing(owner, name, (res.outcome as { error: string }).error);
  if (res.repo && isOwnerOf(res.repo, user.login, user.id)) {
    await logAction(c.env.DB, { actor: user.login, role: "owner", action: "scan-request", targetType: "repo", targetId: res.repo.id, label: res.repo.full_name, note: v.status ?? "missing" });
  }
  return reply(v, v.kind === "listed" ? 200 : v.kind === "not-found" ? 404 : 202);
});
