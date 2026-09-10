// HTML pages (each also answers as .json / .md via respond()).
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import {
  feed, getRepo, repoTags, comments as loadComments, awardsFor, userVote, userVotesFor, siteStats, facetCounts,
  getUserByLogin, castVote, addComment, castCommentVote, rateLimit, logAction, parseJson, curatedTags, getTag, capacity, type Sort, SORTS, type RepoRow,
} from "../lib/db";
import { ipHash } from "../lib/trust";
import { recordView } from "../lib/views";
import { anonId, castAnonVote } from "../lib/anon";
import { llamaGuard, budgetAllows, spendNeurons } from "../lib/content";
import { respond } from "../lib/negotiate";
import { parseQuery } from "../lib/searchquery";
import { Layout, SITE } from "../views/layout";
import { FeedList, ogImage } from "../views/feed";
import { Rail, type RailData } from "../views/rail";
import { Mascot, Stamp } from "../views/art";
import { RepoPage, type RepoPageData } from "../views/repo";
import { feedMd, repoMd } from "../views/md";
import { requireUser, body, wantsJson } from "../middleware";
import { renderMarkdown, escapeHtml } from "../lib/markdown";
import { allBuckets } from "../lib/db";
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";
import { checkOne } from "../jobs/recrawl";
import { runCron } from "../index";
import { isOwnerOf } from "./owner";
import { vocabJson, CONTROLLED, DECLARED_FACETS, DETECTED_FACETS } from "../lib/vocab";
import { MINIMAL_EXAMPLE } from "../lib/slopmd";
import { ago, isoDate } from "../lib/time";

export const pages = new Hono<AppEnv>();

async function railData(db: D1Database): Promise<RailData> {
  const [stats, tags, tools] = await Promise.all([
    siteStats(db),
    curatedTags(db),
    db.prepare(
      "SELECT rt.value, count(*) AS n, avg(r.score) AS mean FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE rt.facet = 'built_with' AND r.status = 'listed' GROUP BY rt.value ORDER BY mean DESC, n DESC LIMIT 8",
    ).all<{ value: string; n: number; mean: number }>().then((r) => r.results ?? []),
  ]);
  return { stats, tools, tags };
}

function sortParam(s: string | undefined): Sort {
  return (SORTS as readonly string[]).includes(s ?? "") ? (s as Sort) : "hot";
}

const feedJson = (rows: RepoRow[], page: number, hasMore: boolean) => ({
  page, has_more: hasMore, next: hasMore ? page + 1 : null,
  repos: rows.map(repoJson),
});

export function repoJson(r: RepoRow) {
  return {
    id: r.id, full_name: r.full_name, owner: r.owner, name: r.name, url: `/r/${r.full_name}`, github: `https://github.com/${r.full_name}`,
    title: r.title ?? r.name, tagline: r.tagline, demo_url: r.demo_url, language: r.language, license: r.license, stars: r.stars, forks: r.forks,
    status: r.status, tier: r.tier, queue_reason: r.queue_reason, reject_reason: r.reject_reason, removed_reason: r.removed_reason, risk: r.risk,
    score: r.score, up: r.up, down: r.down, hot: r.hot, controversy: r.controversy, comment_count: r.comment_count,
    meta: parseJson(r.meta, null), first_seen: r.first_seen, listed_at: r.listed_at, submitted_at: r.submitted_at, md_updated_at: r.md_updated_at, last_crawled: r.last_crawled,
  };
}

// ---- generic feed page renderer ----
async function feedPage(c: Context<AppEnv>, opts: {
  title: string; heading: string; sort: Sort; t?: string; page: number; filters?: ReturnType<typeof parseQuery>["filters"]; match?: string | null;
  status?: RepoRow["status"] | RepoRow["status"][]; owner?: string; tag?: string; baseUrl: string; intro?: string; empty?: string; showStatus?: boolean; extra?: unknown; description?: string; q?: string; showHero?: boolean;
}) {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const [{ rows, hasMore, page }, rail] = await Promise.all([
    feed(c.env.DB, { sort: opts.sort, t: opts.t, page: opts.page, filters: opts.filters, match: opts.match, status: opts.status, owner: opts.owner, tag: opts.tag }),
    railData(c.env.DB),
  ]);
  const votes = user ? await userVotesFor(c.env.DB, user.id, rows.map((r) => r.id)) : new Map<number, number>();
  const winner = opts.showHero ? await c.env.DB.prepare("SELECT r.*, a.period FROM awards a JOIN repos r ON r.id = a.repo_id WHERE a.kind = 'day' AND a.rank = 1 ORDER BY a.period DESC LIMIT 1").first<RepoRow & { period: string }>() : null;
  return respond(c, { rows, page, hasMore, votes, winner }, {
    json: (d) => ({ ...feedJson(d.rows, d.page, d.hasMore), title: opts.title, extra: opts.extra }),
    md: (d) => feedMd(opts.heading, d.rows, d.page, d.hasMore, opts.intro),
    html: (d) => (
      <Layout meta={{ title: opts.title, description: opts.description ?? opts.intro ?? SITE.tagline }} user={user} url={url} sort={opts.showHero ? opts.sort : undefined} q={opts.q} tags={rail.tags}>
        <section>
          {opts.showHero ? (
            <>
              <div class="hero">
                <Mascot size={150} class="hero-pig" />
                <div><h1>SlopScore — {SITE.tagline}</h1><p><em>{SITE.slogan}</em> {SITE.description} A public leaderboard for AI-generated software: opt in by committing one file, humans and agents grade it.</p></div>
              </div>
              <div class="manifesto"><strong>Why public?</strong> {SITE.manifesto}</div>
              {d.winner ? (
                <div class="strip"><Stamp class="strip-stamp" title={`Certified Slop of the Day ${d.winner.period}`} /><span class="stamp">Slop of the Day · {d.winner.period}</span> <a href={`/r/${d.winner.full_name}`}><strong>{d.winner.title ?? d.winner.name}</strong></a> <span class="muted">— {d.winner.tagline}</span> <span class="muted">· score {d.winner.score}</span></div>
              ) : null}
            </>
          ) : <h2 style="margin:8px 0">{opts.heading}</h2>}
          {opts.intro && !opts.showHero ? <p class="muted">{opts.intro}</p> : null}
          {opts.showHero || opts.sort !== "hot" ? (
            <div class="muted" style="margin:4px 0">
              sort: {SORTS.filter((s) => s !== "upcoming").map((s) => <a href={`${opts.baseUrl}${opts.baseUrl.includes("?") ? "&" : "?"}sort=${s}`} class={s === opts.sort ? "chip ok" : "chip"}>{s}</a>)}
              {opts.sort === "top" || opts.sort === "controversial" ? <> · window: {["day", "week", "month", "year", "all"].map((w) => <a href={`${opts.baseUrl}${opts.baseUrl.includes("?") ? "&" : "?"}sort=${opts.sort}&t=${w}`} class={w === (opts.t ?? "all") ? "chip ok" : "chip"}>{w}</a>)}</> : null}
            </div>
          ) : null}
          <FeedList rows={d.rows} page={d.page} hasMore={d.hasMore} votes={d.votes} user={user} baseUrl={opts.baseUrl + (opts.baseUrl.includes("?") ? "&" : "?") + `sort=${opts.sort}${opts.t ? `&t=${opts.t}` : ""}`} empty={opts.empty} showStatus={opts.showStatus} />
        </section>
        <Rail data={rail} />
      </Layout>
    ),
  });
}

// ---- / ----
pages.get("/", (c) => {
  const sort = sortParam(c.req.query("sort"));
  if (sort === "upcoming") return c.redirect("/upcoming");
  return feedPage(c, { title: `SlopScore — ${SITE.tagline}`, heading: "SlopScore — the feed", sort, t: c.req.query("t"), page: Number(c.req.query("page") ?? 1), baseUrl: "/", showHero: true, description: `${SITE.slogan} ${SITE.description}`, intro: SITE.manifesto });
});

pages.get("/upcoming", (c) => feedPage(c, {
  title: "Up and coming slop", heading: "Up and coming", sort: "upcoming", page: Number(c.req.query("page") ?? 1), baseUrl: "/upcoming",
  intro: "Listed repos whose authors admit they're not done: idea, prototype, works-on-my-machine, alpha. Once submitted they compete for Most Promising Slop of the Week.",
  empty: "Nobody is working on anything. Suspicious.",
}));

pages.get("/search", (c) => {
  const q = c.req.query("q") ?? "";
  const parsed = parseQuery(q);
  const sort = sortParam(c.req.query("sort") ?? "top");
  return feedPage(c, {
    title: `search: ${q} — SlopScore`, heading: `Search: ${q}`, sort, t: c.req.query("t"), page: Number(c.req.query("page") ?? 1),
    filters: parsed.filters, match: parsed.match, baseUrl: `/search?q=${encodeURIComponent(q)}`, q,
    intro: parsed.terms.length ? `Parsed as: ${parsed.terms.join(" ")}` : "Operators: category: lang: tool: model: platform: interface: audience: data: human: ai: status: tag: topic: license: owner: — prefix with - to exclude.",
    empty: "Nothing matches. Either it doesn't exist or nobody admitted to it.", extra: { parsed },
  });
});

pages.get("/f/:facet/:value", async (c) => {
  const facet = c.req.param("facet"); const value = c.req.param("value").toLowerCase();
  const known = [...DECLARED_FACETS, ...DETECTED_FACETS] as readonly string[];
  if (!known.includes(facet)) return c.notFound();
  const siblings = await facetCounts(c.env.DB, facet, 30);
  return feedPage(c, {
    title: `${facet}: ${value} — SlopScore`, heading: `${facet} = ${value}`, sort: sortParam(c.req.query("sort") ?? "top"), t: c.req.query("t"), page: Number(c.req.query("page") ?? 1),
    filters: [{ facet, value, negate: false }], baseUrl: `/f/${facet}/${value}`,
    intro: `Other ${facet} values: ${siblings.filter((s) => s.value !== value).slice(0, 15).map((s) => `${s.value} (${s.n})`).join(", ")}`, extra: { facet, value, siblings },
  });
});

pages.get("/t", (c) => c.redirect("/b"));
pages.get("/t/:tag", (c) => c.redirect(`/b/${c.req.param("tag")}`));

pages.get("/b", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const all = await allBuckets(c.env.DB);
  const tags = all.filter((b) => b.curated && !b.banned);
  const community = all.filter((b) => !b.curated && !b.banned);
  const banned = all.filter((b) => b.banned);
  const free = await facetCounts(c.env.DB, "tags", 60);
  return respond(c, { tags, community, banned, free }, {
    json: (d) => ({ curated: d.tags, community: d.community, banned: d.banned.map((b) => ({ slug: b.slug, reason: b.banned_reason })), free_tags: d.free, declare: "slopbucket: [cli, devtools]  # up to 3; unknown buckets are created" }),
    md: (d) => ["# Slopbuckets", "", "Subreddit-style feeds. Declare up to three in slopscore.md with `slopbucket: [cli, devtools]`; unknown buckets are created on the spot. A repo also lands in a bucket when its category, tags, domain, or GitHub topics match.", "", "## Curated", "", ...d.tags.map((t) => `- [b/${t.slug}](/b/${t.slug}) — ${t.title}: ${t.blurb ?? ""} (${t.n})`), "", "## Community", "", d.community.map((t) => `[b/${t.slug}](/b/${t.slug}) (${t.n})`).join(" · ") || "_none yet_", "", "## Banned", "", d.banned.map((t) => `${t.slug} — ${t.banned_reason}`).join("; ") || "_none_", "", "## Free tags", "", d.free.map((f) => `[${f.value}](/b/${f.value}) (${f.n})`).join(" · ")].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Slopbuckets — SlopScore" }} user={user} url={url} tags={d.tags}>
        <section class="wrap narrow" style="padding:0">
          <h2>Slopbuckets</h2>
          <p class="muted">Subreddit-style feeds. Pick up to three in your <code>slopscore.md</code> with <code>slopbucket: [cli, devtools]</code>, or invent one and it is created on the spot. A repo also lands in a bucket when its category, tags, domain, or GitHub topics match. Buckets that get out of control get banned by a mod, in public.</p>
          <table class="list"><tr><th>bucket</th><th>what goes here</th><th>slop</th></tr>
            {d.tags.map((t) => <tr><td><a href={`/b/${t.slug}`}><strong>b/{t.slug}</strong></a></td><td>{t.title} <span class="muted">— {t.blurb}</span></td><td>{t.n}</td></tr>)}
          </table>
          <h3>Community buckets</h3>
          <p>{d.community.length ? d.community.map((t) => <a class="chip" href={`/b/${t.slug}`}>{t.slug} ({t.n})</a>) : <span class="muted">None yet. Declare one and it appears here.</span>}</p>
          {d.banned.length ? <><h3>Banned</h3><p>{d.banned.map((t) => <span class="chip bad" title={t.banned_reason ?? ""}>{t.slug}</span>)}</p></> : null}
          <h3>Free tags</h3>
          <p>{d.free.map((f) => <a class="chip" href={`/b/${f.value}`}>{f.value} ({f.n})</a>)}</p>
        </section>
      </Layout>
    ),
  });
});

pages.get("/b/:tag", async (c) => {
  const slug = c.req.param("tag").toLowerCase();
  const tag = await getTag(c.env.DB, slug);
  if (tag?.banned) return c.text(`b/${slug} is banned: ${tag.banned_reason ?? "out of control"}. See /log.`, 404);
  return feedPage(c, {
    title: `b/${slug} — ${tag?.title ?? slug} — SlopScore`, heading: `b/${slug}${tag ? ` · ${tag.title}` : ""}`, sort: sortParam(c.req.query("sort") ?? "hot"), t: c.req.query("t"), page: Number(c.req.query("page") ?? 1),
    tag: slug, baseUrl: `/b/${slug}`, intro: tag?.blurb ?? `Everything in the ${slug} bucket, by declared slopbucket, category, tag, domain, or GitHub topic.`, extra: { bucket: tag ?? { slug, curated: 0 } },
    empty: `No slop in b/${slug} yet. Be the first slopsmith: slopbucket: [${slug}]`,
  });
});

pages.get("/u/:login", async (c) => {
  const login = c.req.param("login");
  const u = await getUserByLogin(c.env.DB, login);
  return feedPage(c, {
    title: `${login} — SlopScore`, heading: `Slop by ${login}`, sort: sortParam(c.req.query("sort") ?? "new"), page: Number(c.req.query("page") ?? 1),
    owner: login, status: ["listed", "discovered", "quarantined", "rejected"], baseUrl: `/u/${login}`, showStatus: true,
    intro: u ? `Slopsmith since ${isoDate(u.created_at)}${u.banned_at ? " · banned" : ""}. github.com/${login}` : `github.com/${login} — not a slopsmith (yet).`, extra: { user: u ? { id: u.id, login: u.login, avatar_url: u.avatar_url } : null },
    empty: "No slop from this account. Yet.",
  });
});

pages.get("/queue", async (c) => {
  const st = c.req.query("status");
  const user = c.get("user"); const url = new URL(c.req.url);
  const page = Number(c.req.query("page") ?? 1);
  const cap = await capacity(c.env.DB, c.env);
  // Three lines: paid jumpers (FIFO), the free line (FIFO), then everything else by filter.
  const [paid, free, other, rail] = await Promise.all([
    st ? Promise.resolve({ rows: [] as RepoRow[], hasMore: false, page: 1 }) : feed(c.env.DB, { sort: "new", status: "discovered", queue: true, priority: true, page: 1 }),
    st ? Promise.resolve({ rows: [] as RepoRow[], hasMore: false, page: 1 }) : feed(c.env.DB, { sort: "new", status: "discovered", queue: true, priority: false, page }),
    feed(c.env.DB, { sort: "new", page: st ? page : 1, status: st === "rejected" ? ["rejected"] : st === "hidden" ? ["hidden"] : st === "quarantined" ? ["quarantined"] : st === "delisted" ? ["delisted"] : st === "discovered" ? ["discovered"] : ["quarantined", "rejected"], queue: st === "discovered" }),
    railData(c.env.DB),
  ]);
  const ids = [...paid.rows, ...free.rows, ...other.rows].map((r) => r.id);
  const votes = user ? await userVotesFor(c.env.DB, user.id, ids) : new Map<number, number>();
  const intro = "Everything the crawler found that isn't listed yet, and why. Paid jumpers are one first-in-first-out line, drained before the free line, which is also first-in-first-out. Nothing here is votable; everything is readable and reportable. Rejected repos re-enter detection when the owner presses Refresh or anyone pings them after a fix.";
  return respond(c, { cap, paid: paid.rows, free: free.rows, other: other.rows, freeMore: free.hasMore, otherMore: other.hasMore, page }, {
    json: (d) => ({ capacity: d.cap, jumpers: d.paid.map(repoJson), free_line: d.free.map(repoJson), other: d.other.map(repoJson), page: d.page, filter: st ?? null }),
    md: (d) => [
      "# In the trough", "", intro, "",
      `**Mode: ${d.cap.mode}.** AI budget today ${d.cap.neurons_used}/${d.cap.budget} neurons ≈ ${d.cap.scans_left_today} of ${d.cap.scans_per_day} free scans left. Paid scans: ${d.cap.paid_scans_unlimited ? `unlimited via ${d.cap.paid_scan_provider}` : "priority only; same daily ceiling until the site moves to a paid plan"}.`, "",
      "## Jumpers (paid, FIFO)", "", ...(d.paid.length ? d.paid.map((r, i) => `${i + 1}. [${r.full_name}](/r/${r.full_name}) — paid ${isoDate(r.priority_at)}`) : ["_nobody has paid to jump. The line is honest today._"]), "",
      "## Free line (FIFO)", "", ...(d.free.length ? d.free.map((r, i) => `${(d.page - 1) * 25 + i + 1}. [${r.full_name}](/r/${r.full_name}) — ${r.queue_reason ?? "awaiting-scan"} · found ${ago(r.first_seen)}`) : ["_empty. The inspector is bored._"]), "",
      "## Needs a human or was rejected", "", ...d.other.map((r) => `- [${r.full_name}](/r/${r.full_name}) — **${r.status}**${r.reject_reason ? `: ${r.reject_reason}` : r.queue_reason ? ` (${r.queue_reason})` : ""}`),
    ].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "The trough — moderation queue", description: intro }} user={user} url={url} tags={rail.tags}>
        <section>
          <h2 style="margin:8px 0">In the trough</h2>
          <p class="muted">{intro}</p>
          <div class={`capacity ${d.cap.mode}`}>
            <div><span class="label">mode</span><strong>{d.cap.mode === "free" ? "free tier" : "paid plan"}</strong></div>
            <div><span class="label">AI budget today</span><strong>{d.cap.neurons_used} / {d.cap.budget}</strong> neurons</div>
            <div><span class="label">free scans left today</span><strong>{d.cap.scans_left_today}</strong> of ~{d.cap.scans_per_day}</div>
            <div><span class="label">paid scans</span><strong>{d.cap.paid_scans_unlimited ? "unlimited" : "front of the line, same ceiling"}</strong> <span class="muted">via {d.cap.paid_scan_provider}</span></div>
            <div><span class="label">daily limits</span><span>{d.cap.limits.workers_requests_per_day ? `${(d.cap.limits.workers_requests_per_day / 1000).toFixed(0)}k requests · ` : "unlimited requests · "}{d.cap.limits.ai_neurons_per_day ? `${(d.cap.limits.ai_neurons_per_day / 1000).toFixed(0)}k neurons · ` : "metered AI · "}{(d.cap.limits.d1_writes_per_day / 1000).toFixed(0)}k D1 writes</span></div>
            <div><span class="label">in line</span><span><strong>{d.cap.queue.paid}</strong> paid · <strong>{d.cap.queue.free}</strong> free · <strong>{d.cap.queue.deferred}</strong> waiting on budget</span></div>
            <p class="muted small">Budget resets at 00:00 UTC. When "waiting on budget" grows day over day, the free tier is the bottleneck and it's time to pay for a bigger trough. <a href="/stats">History</a>.</p>
          </div>
          {!st ? (
            <>
              <h3>Jumpers <span class="muted">· paid, first come first served</span></h3>
              <FeedList rows={d.paid} page={1} hasMore={false} votes={votes} user={user} baseUrl="/queue" empty="Nobody has paid to jump. The line is honest today." showStatus />
              <h3>Free line <span class="muted">· first come first served, after the jumpers</span></h3>
              <FeedList rows={d.free} page={d.page} hasMore={d.freeMore} votes={votes} user={user} baseUrl="/queue" empty="The free line is empty. The inspector is bored." showStatus />
              <h3>Needs a human, or rejected <span class="muted">· <a href="/queue?status=quarantined">quarantined</a> · <a href="/queue?status=rejected">rejected</a> · <a href="/queue?status=hidden">hidden</a> · <a href="/queue?status=delisted">delisted</a></span></h3>
            </>
          ) : <h3>{st}</h3>}
          <FeedList rows={d.other} page={st ? d.page : 1} hasMore={d.otherMore} votes={votes} user={user} baseUrl={`/queue${st ? `?status=${st}` : ""}`} empty="Nothing here. Suspicious." showStatus />
        </section>
        <Rail data={rail} />
      </Layout>
    ),
  });
});

pages.get("/best", async (c) => {
  const kind = c.req.query("kind") === "week" ? "week" : c.req.query("kind") === "upcoming-week" ? "upcoming-week" : "day";
  const period = c.req.query("period");
  const user = c.get("user"); const url = new URL(c.req.url);
  const rows = await c.env.DB.prepare(
    `SELECT r.*, a.period, a.rank FROM awards a JOIN repos r ON r.id = a.repo_id WHERE a.kind = ? ${period ? "AND a.period = ?" : ""} ORDER BY a.period DESC, a.rank ASC LIMIT 100`,
  ).bind(...(period ? [kind, period] : [kind])).all<RepoRow & { period: string; rank: number }>().then((r) => r.results ?? []);
  const votes = user ? await userVotesFor(c.env.DB, user.id, rows.map((r) => r.id)) : new Map<number, number>();
  const rail = await railData(c.env.DB);
  return respond(c, { rows }, {
    json: (d) => ({ kind, period: period ?? null, winners: d.rows.map((r) => ({ period: r.period, rank: r.rank, ...repoJson(r) })) }),
    md: (d) => feedMd(`Winners — ${kind}${period ? ` ${period}` : ""}`, d.rows, 1, false),
    html: (d) => (
      <Layout meta={{ title: `Winners — Slop of the ${kind} — SlopScore` }} user={user} url={url}>
        <section>
          <h2>🏆 Certified Slop of the {kind === "day" ? "Day" : kind === "week" ? "Week" : "Week (Most Promising)"}</h2>
          <p class="muted">Only submitted repos compete. <a href="/best?kind=day">day</a> · <a href="/best?kind=week">week</a> · <a href="/best?kind=upcoming-week">most promising</a></p>
          {d.rows.length === 0 ? <div class="empty">No winners yet. The awards cron runs at 00:05 UTC.</div> : null}
          {Object.entries(groupBy(d.rows, (r) => r.period)).map(([p, rs]) => (
            <>
              <h3>{p}</h3>
              <FeedList rows={rs} page={1} hasMore={false} votes={votes} user={user} baseUrl={`/best?kind=${kind}&period=${p}`} />
            </>
          ))}
        </section>
        <Rail data={rail} />
      </Layout>
    ),
  });
});

pages.get("/tools", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const rows = await c.env.DB.prepare(
    `SELECT rt.value, count(*) AS n, round(avg(r.score), 2) AS mean, max(r.score) AS best,
       (SELECT r2.full_name FROM repo_tags t2 JOIN repos r2 ON r2.id = t2.repo_id WHERE t2.facet = 'built_with' AND t2.value = rt.value AND r2.status = 'listed' ORDER BY r2.score DESC LIMIT 1) AS best_repo
     FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE rt.facet = 'built_with' AND r.status = 'listed' GROUP BY rt.value ORDER BY mean DESC, n DESC`,
  ).all<{ value: string; n: number; mean: number; best: number; best_repo: string }>().then((r) => r.results ?? []);
  return respond(c, { rows }, {
    json: (d) => ({ facet: "built_with", leaderboard: d.rows }),
    md: (d) => ["# Which AI produces the best slop?", "", "| tool | listings | mean score | best |", "|---|---|---|---|", ...d.rows.map((r) => `| ${r.value} | ${r.n} | ${r.mean} | [${r.best_repo}](/r/${r.best_repo}) (${r.best}) |`)].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Built with — which AI produces the best slop? — SlopScore" }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <h2>Which AI produces the best slop?</h2>
          <p class="muted">Mean score of listed repos by declared <code>built_with</code>. Small samples lie; that's part of the fun.</p>
          <table class="list"><tr><th>#</th><th>tool</th><th>listings</th><th>mean score</th><th>best</th></tr>
            {d.rows.map((r, i) => <tr><td>{i + 1}</td><td><a href={`/f/built_with/${r.value}`}>{r.value}</a></td><td>{r.n}</td><td>{r.mean}</td><td><a href={`/r/${r.best_repo}`}>{r.best_repo}</a> ({r.best})</td></tr>)}
          </table>
        </section>
      </Layout>
    ),
  });
});

pages.get("/log", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const rows = await c.env.DB.prepare("SELECT * FROM mod_log ORDER BY created_at DESC LIMIT 200").all<{ id: number; actor_login: string; actor_role: string; action: string; target_type: string; target_id: number; target_label: string | null; note: string | null; created_at: number }>().then((r) => r.results ?? []);
  return respond(c, { rows }, {
    json: (d) => ({ log: d.rows }),
    md: (d) => ["# Moderation log", "", ...d.rows.map((r) => `- ${isoDate(r.created_at)} **${r.actor_login}** (${r.actor_role}) ${r.action} ${r.target_type} ${r.target_label ?? r.target_id}${r.note ? ` — ${r.note}` : ""}`)].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Moderation log — SlopScore" }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <h2>Moderation log</h2>
          <p class="muted">Every admin and owner action, in public. Nothing here is a secret.</p>
          <table class="list"><tr><th>when</th><th>who</th><th>action</th><th>target</th><th>note</th></tr>
            {d.rows.map((r) => <tr><td title={isoDate(r.created_at)}>{ago(r.created_at)}</td><td><a href={`/u/${r.actor_login}`}>{r.actor_login}</a> <span class="muted">{r.actor_role}</span></td><td>{r.action}</td><td>{r.target_type === "repo" && r.target_label ? <a href={`/r/${r.target_label}`}>{r.target_label}</a> : `${r.target_type} ${r.target_id}`}</td><td class="muted">{r.note}</td></tr>)}
          </table>
          {d.rows.length === 0 ? <div class="empty">Nothing has needed moderating. Suspicious.</div> : null}
        </section>
      </Layout>
    ),
  });
});

pages.get("/stats", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const [stats, daily, byStatus] = await Promise.all([
    siteStats(c.env.DB),
    c.env.DB.prepare("SELECT * FROM stats_daily ORDER BY date DESC LIMIT 30").all<Record<string, number | string>>().then((r) => r.results ?? []),
    c.env.DB.prepare("SELECT status, count(*) AS n FROM repos GROUP BY status").all<{ status: string; n: number }>().then((r) => r.results ?? []),
  ]);
  const budget = Number(c.env.AI_NEURON_BUDGET || 9000);
  const cap = await capacity(c.env.DB, c.env);
  return respond(c, { stats, daily, byStatus, budget, cap }, {
    json: (d) => ({ capacity: d.cap, by_status: d.byStatus, stats: d.stats, daily: d.daily }),
    md: (d) => ["# Stats", "", `Mode: **${d.cap.mode}** · AI today ${d.cap.neurons_used}/${d.cap.budget} · free scans left ${d.cap.scans_left_today}/${d.cap.scans_per_day} · in line: ${d.cap.queue.paid} paid, ${d.cap.queue.free} free, ${d.cap.queue.deferred} waiting on budget`, "", ...d.byStatus.map((s) => `- ${s.status}: ${s.n}`), "", `AI neuron budget/day: ${d.budget}`, "", "| date | neurons | scans | deferred | found | listed | rejected | quarantined |", "|---|---|---|---|---|---|---|---|", ...d.daily.map((r) => `| ${r.date} | ${r.neurons_used}/${r.neurons_budget} | ${r.scans} | ${r.deferred} | ${r.found} | ${r.listed} | ${r.rejected} | ${r.quarantined} |`)].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Stats — SlopScore" }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <h2>Stats</h2>
          <p class="muted">This site runs on Cloudflare's free tier on purpose. When the "deferred" column grows day over day, the AI budget is the bottleneck and it's time to pay.</p>
          <div class={`capacity ${d.cap.mode}`}>
            <div><span class="label">mode</span><strong>{d.cap.mode === "free" ? "free tier" : "paid plan"}</strong></div>
            <div><span class="label">AI budget today</span><strong>{d.cap.neurons_used} / {d.cap.budget}</strong> neurons · <strong>{d.cap.scans_left_today}</strong> of ~{d.cap.scans_per_day} free scans left</div>
            <div><span class="label">in line</span><span><strong>{d.cap.queue.paid}</strong> paid · <strong>{d.cap.queue.free}</strong> free · <strong>{d.cap.queue.deferred}</strong> waiting on budget</span></div>
          </div>
          <table class="stats">{d.byStatus.map((s) => <tr><td>{s.status}</td><td>{s.n}</td></tr>)}<tr><td>slopsmiths</td><td>{d.stats.users}</td></tr><tr><td>votes</td><td>{d.stats.votes}</td></tr><tr><td>comments</td><td>{d.stats.comments}</td></tr></table>
          <h3>Last 30 days</h3>
          <table class="list"><tr><th>date</th><th>AI neurons</th><th>scans</th><th>deferred</th><th>found</th><th>listed</th><th>rejected</th><th>quarantined</th></tr>
            {d.daily.map((r) => <tr><td>{r.date}</td><td>{r.neurons_used} / {r.neurons_budget || d.budget}</td><td>{r.scans}</td><td>{r.deferred}</td><td>{r.found}</td><td>{r.listed}</td><td>{r.rejected}</td><td>{r.quarantined}</td></tr>)}
          </table>
          {d.daily.length === 0 ? <div class="empty">No days recorded yet. The crons write one row per UTC day.</div> : null}
        </section>
      </Layout>
    ),
  });
});

pages.get("/spec", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const v = vocabJson();
  const md = [
    "# slopscore.md — the contract (v1)", "",
    "Principle: the file only holds what GitHub can't tell us. Name, description, topics, language, license, stars, README, and release come from the API.", "",
    "Missing or invalid **disclosure** fields reject the repo with the reason shown publicly on its page. Fix the file, then `curl /ping/owner/repo` (or press Refresh if you own it).", "",
    "## Minimal file", "", "```yaml", MINIMAL_EXAMPLE.trim(), "```", "",
    "## Required (disclosures)", "",
    ...["slopscore: 1 (spec version)", `ai_generated: ${v.controlled.ai_generated.join(" | ")}`, `human_touch: ${v.controlled.human_touch.join(" | ")}`, "content_rating: everyone (mature | adult are rejected)",
      `contains: list, may be empty. Listed with a chip: ${v.contains.listed.join(", ")}. Rejected: ${v.contains.rejected.join(", ")}.`, `category: ≥ 1 of ${v.controlled.category.join(", ")}`, `status: ${v.controlled.status.join(" | ")}`,
      "tagline: ≤ 140 chars, or a GitHub description (rejected only if both are empty)"].map((x) => `- ${x}`), "",
    "## Optional facets (unknown values never reject; they're kept as free tags marked unrecognized)", "",
    ...["title, tagline, demo_url — override GitHub", `built_with: ${v.controlled.built_with.join(", ")}`, "models: free", `interface: ${v.controlled.interface.join(", ")}`, "frameworks: free (aliases normalized: next.js→nextjs)", `platforms: ${v.controlled.platforms.join(", ")}`,
      `audience: ${v.controlled.audience.join(", ")}`, `data: ${v.controlled.data.join(", ")}`, "needs: free (external accounts/keys)", "domain: free (subject matter)", "tags: free, ≤ 20; GitHub topics are merged in as detected",
      "slopbucket: up to 3 buckets (subreddit-style feeds at /b); unknown ones are created, banned ones stripped", "images: explicit repo-relative image paths (else slopscore-1.png … slopscore-6.png at the root are auto-discovered)", "maintainers: GitHub logins who get owner controls on the site (the only way for an org-owned repo)", "unlisted: true — delist on next check without logging in", "x-anything: preserved verbatim, never validated"].map((x) => `- ${x}`), "",
    "## Body", "", "Optional markdown after the frontmatter, ≤ 4000 chars: the pitch. If empty, the README is the pitch.", "",
    "## Aliases", "", ...Object.entries(v.aliases).map(([k, val]) => `- ${k} → ${val}`), "",
    "## Search operators", "", Object.keys(v.search_operators).map((k) => `${k}:`).join(" "), " — prefix with `-` to exclude. Quotes for phrases.", "",
    "Machine-readable: `/api/v1/vocab`.",
  ].join("\n");
  return respond(c, { md, vocab: v }, {
    json: (d) => d.vocab,
    md: (d) => d.md,
    html: (d) => <Layout meta={{ title: "slopscore.md spec — SlopScore" }} user={user} url={url}><section class="wrap narrow" style="padding:0">{(() => { const html = renderMarkdown(d.md); return <div dangerouslySetInnerHTML={{ __html: html }} />; })()}</section></Layout>,
  });
});

pages.get("/about", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const md = [
    "# About SlopScore", "", `**${SITE.tagline}**`, "", SITE.manifesto, "",
    "## The problem", "",
    "Anyone can now generate a working-looking repo in an afternoon. Most of it is never run by anyone but its author, and the places that used to sort software (stars, Hacker News, Product Hunt) either ignore it or drown in it. Nobody wants to admit their project was generated, so the disclosures that would let you judge it are missing, and the good stuff is indistinguishable from the pile.", "",
    "SlopScore flips the incentive. You *brag* that it's slop. You disclose how much was generated, how much a human touched, and what's inside, in a six-line file. Then graders, human and otherwise, tell you whether it actually works. The disclosures are the price of admission; the leaderboard is the reward.", "",
    "## Meet Schnitzel", "",
    "The pig is Schnitzel. He runs the trough. He is not disgusted by slop; he is a connoisseur of it, and he has opinions. The slop on his chin is from lunch. He grades with a clipboard, sniffs out every `slopscore.md` on GitHub, and stamps the winners *Certified Slop*. If your repo is rejected, it's because Schnitzel found the paperwork lacking, never because he found the slop lacking. He has never found the slop lacking.", "",
    "## What it is", "",
    "SlopScore is a public, tongue-in-cheek leaderboard for AI-generated software. A repo owner opts in by committing a `slopscore.md` file. A crawler finds it, checks the disclosures, runs content gates, and lists it. GitHub-authenticated humans and agents (we call them slopsmiths) upvote, downvote, comment, and (quietly) report.", "",
    "## What we store", "", "Only our own database: listings, votes, comments, reports, and the moderation log. GitHub owns identity, code, images, and the marker file. Log in with GitHub; we keep your id, login, and avatar, and discard the token.", "",
    "## Transparency", "", "Every status has a public reason. The scan report is on every repo page. The [moderation log](/log) is public. The [queue](/queue) is public. The [stats](/stats) are public, including how close the site is to its free-tier limits. The [source](https://github.com/NTBooks/slopscore) is public.", "",
    "## Tiers", "", "A repo the crawler finds is **found**: listed and votable, with an *unclaimed* chip. When the owner logs in and presses Submit it becomes **submitted**: a launch, eligible for Slop of the Day and the weekly awards. Votes carry over.", "",
    "## Votes", "", "Only logged-in slopsmiths vote. Votes are weighted by account trust derived from GitHub (age, public repos, followers), rate-limited per account and per network, and bursts from same-week accounts or one network count for nothing. Displayed scores are lightly fuzzed so bots can't tell whether they counted. This is roughly how Reddit does it; the knobs are public in the repo.", "",
    "## Moderation", "", "Cheapest first: GitHub's own enforcement, a denylist, a risk score that quarantines suspicious repos for a human, Safe Browsing, Llama Guard on the text and a vision check on the thumbnail, community reports with auto-hide, then admins. Nothing is votable until it's listed.", "",
    "## For agents", "", "Append `.json` or `.md` to any page. See [/llms.txt](/llms.txt), [/openapi.json](/openapi.json), and the MCP server at `/mcp`.",
  ].join("\n");
  return respond(c, { md }, {
    json: (d) => ({ about: d.md }),
    md: (d) => d.md,
    html: (d) => <Layout meta={{ title: "About — SlopScore" }} user={user} url={url}><section class="wrap narrow" style="padding:0"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(d.md) }} /></section></Layout>,
  });
});

// ---- /ping ----
pages.get("/ping/:owner/:name", async (c) => {
  const o = c.req.param("owner"); const n = c.req.param("name").replace(/\.git$/, "");
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!(await rateLimit(c.env.DB, `ping:${o}/${n}`.toLowerCase(), 1, 600)) || !(await rateLimit(c.env.DB, `ping-ip:${ip}`, 10, 600))) {
    const existing = await getRepo(c.env.DB, o, n);
    return c.json({ ok: false, error: "pinged recently; try again in 10 minutes", status: existing?.status ?? null, url: existing ? `/r/${existing.full_name}` : null }, 429);
  }
  const gh = new GitHub(c.env.GITHUB_CRAWL_TOKEN);
  const res = await scanRepo(c.env.DB, c.env, gh, o, n);
  if (!res.repo) return c.json({ ok: false, error: (res.outcome as { error: string }).error, hint: "Commit a slopscore.md to the root of the default branch. Spec: /spec" }, 404);
  const r = res.repo;
  const deferred = !("error" in res.outcome) && res.outcome.deferred;
  return c.json({ ok: r.status === "listed", status: r.status, tier: r.tier, url: `/r/${r.full_name}`, reject_reason: r.reject_reason, deferred: Boolean(deferred), hint: deferred ? "AI budget for today is spent; queued for the next window (00:00 UTC). See /queue." : undefined, scan: parseJson(r.scan, null) }, r.status === "listed" ? 200 : 202);
});

// ---- repo page ----
pages.get("/r/:owner/:name", async (c) => {
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  const user = c.get("user"); const url = new URL(c.req.url);
  if (!r) {
    return respond(c, { owner: c.req.param("owner"), name: c.req.param("name") }, {
      json: (d) => ({ error: "not listed", hint: `GET /ping/${d.owner}/${d.name} after committing slopscore.md` }),
      md: (d) => `# Not listed\n\nNo listing for ${d.owner}/${d.name}. Commit a slopscore.md then GET /ping/${d.owner}/${d.name}.`,
      html: (d) => <Layout meta={{ title: "Not listed — SlopScore", noindex: true }} user={user} url={url}><section class="wrap narrow" style="padding:0"><h2>Not listed</h2><p>No listing for <code>{d.owner}/{d.name}</code>. If the repo has a <code>slopscore.md</code>, <a href={`/ping/${d.owner}/${d.name}`}>ping it</a>. Otherwise, <a href="/spec">here's the spec</a>.</p></section></Layout>,
    }, 404);
  }
  c.executionCtx.waitUntil(freshen(c.env, r));
  c.executionCtx.waitUntil(recordView(c.env.DB, r.id, Number(c.env.VIEW_SAMPLE || 1)).catch(() => {}));
  const [tags, cs, awards, versions, mine] = await Promise.all([
    repoTags(c.env.DB, r.id), loadComments(c.env.DB, r.id), awardsFor(c.env.DB, r.id),
    c.env.DB.prepare("SELECT md_sha, seen_at, stars FROM repo_versions WHERE repo_id = ? ORDER BY seen_at DESC LIMIT 20").bind(r.id).all<{ md_sha: string | null; seen_at: number; stars: number | null }>().then((x) => x.results ?? []),
    user ? userVote(c.env.DB, user.id, r.id) : Promise.resolve(0),
  ]);
  const data: RepoPageData = { repo: r, tags, comments: cs, awards, versions, mine, user, isOwner: isOwnerOf(r, user?.login, user?.id), flash: c.req.query("flash") ?? null };
  return respond(c, data, {
    json: (d) => ({ ...repoJson(d.repo), tags: d.tags, awards: d.awards, versions: d.versions, scan: parseJson(d.repo.scan, null), body_md: d.repo.body_md, my_vote: d.mine, is_owner: d.isOwner,
      comments: d.comments.map((x) => ({ id: x.id, parent_id: x.parent_id, user: x.login, maker: x.user_id === d.repo.owner_id, body_md: x.deleted_at ? null : x.body_md, up: x.up, down: x.down, created_at: x.created_at })) }),
    md: (d) => repoMd(d.repo, d.tags, d.comments, d.awards),
    html: (d) => (
      <Layout meta={{ title: `${d.repo.title ?? d.repo.name} — SlopScore`, description: d.repo.tagline ?? undefined, image: ogImage(d.repo), noindex: d.repo.status !== "listed" }} user={user} url={url}>
        <RepoPage d={d} />
        <Rail data={{ stats: { listed: 0, queued: 0, users: 0, votes: 0, comments: 0 }, tools: [], tags: [] }} />
      </Layout>
    ),
  });
});

/** On-visit freshness: one conditional GET per repo per hour at most, throttled through the edge cache, never blocks the response. */
async function freshen(env: AppEnv["Bindings"], r: RepoRow): Promise<void> {
  try {
    if (r.status === "discovered" || env.FRESHNESS === "off") return;   // FRESHNESS=off for local dev with fake seed repos
    const cache = caches.default;
    const key = new Request(`https://slopscore.internal/check/${r.id}`);
    if (await cache.match(key)) return;
    await cache.put(key, new Response("1", { headers: { "cache-control": "max-age=3600" } }));
    if ((r.last_crawled ?? 0) > Math.floor(Date.now() / 1000) - 3600) return;
    await checkOne(env, new GitHub(env.GITHUB_CRAWL_TOKEN), r);
  } catch (e) {
    console.log("freshen failed", (e as Error).message);
  }
}

// ---- badge: embeddable SVG; every README view on GitHub fetches it, which doubles as a visit signal ----
pages.get("/badge/:owner/:name", async (c) => {
  const name = c.req.param("name").replace(/\.svg$/, "");
  const r = await getRepo(c.env.DB, c.req.param("owner"), name);
  const award = c.req.query("award") && r ? await c.env.DB.prepare("SELECT kind, period, rank FROM awards WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1").bind(r.id).first<{ kind: string; period: string; rank: number }>() : null;
  if (r) c.executionCtx.waitUntil(freshen(c.env, r));
  const label = "SlopScore";
  const value = !r ? "not listed" : r.status !== "listed" ? r.status : award ? `#${award.rank} slop of the ${award.kind} · ${award.period}` : `certified slop · ${r.score}`;
  const color = !r ? "#9a9a9a" : r.status === "listed" ? "#e8669a" : r.status === "rejected" ? "#c0392b" : "#b8860b";
  const lw = 8 + label.length * 6.6, vw = 10 + value.length * 6.3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(lw + vw)}" height="20" role="img" aria-label="${label}: ${value}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${Math.round(lw + vw)}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#3a2a2a"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${Math.round(lw + vw)}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">🐷 ${label}</text><text x="${lw / 2}" y="14">🐷 ${label}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeHtml(value)}</text><text x="${lw + vw / 2}" y="14">${escapeHtml(value)}</text></g></svg>`;
  return c.body(svg, 200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=600" });
});

// Local/manual cron trigger for admins: /__cron?cron=*/5+*+*+*+* (admins only in prod; open on localhost)
pages.get("/__cron", async (c) => {
  const host = new URL(c.req.url).hostname;
  const user = c.get("user");
  if (host !== "localhost" && host !== "127.0.0.1" && !user?.isAdmin) return c.json({ error: "admins only" }, 403);
  const cron = c.req.query("cron") ?? "*/5 * * * *";
  return c.json({ cron, result: await runCron(cron, c.env) });
});

// Admin/localhost: accept the Workers AI vision model license and show the raw result.
pages.get("/__ai-agree", async (c) => {
  const host = new URL(c.req.url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && !c.get("user")?.isAdmin) return c.json({ error: "admins only" }, 403);
  if (!c.env.AI) return c.json({ error: "no AI binding" });
  const model = "@cf/meta/llama-3.2-11b-vision-instruct";
  const tries: unknown[] = [];
  for (const input of [{ prompt: "agree" }, { messages: [{ role: "user", content: "agree" }] }]) {
    try { tries.push({ input, ok: await c.env.AI.run(model as never, input as never) }); } catch (e) { tries.push({ input, error: (e as Error).message }); }
  }
  return c.json({ tries });
});

// ---- writes ----
// Anonymous "crowd" vote: shown separately, never ranking. Logged-in users fall through to the real vote.
pages.post("/r/:owner/:name/vote", async (c, next) => {
  if (c.get("user")) return next();
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  if (r.status !== "listed") return c.json({ error: "not yet graded", status: r.status }, 409);
  const v = Number((await body(c)).value);
  if (![1, -1, 0].includes(v)) return c.json({ error: "value must be 1, -1, or 0" }, 400);
  const aid = await anonId(c, c.env.SESSION_SECRET);
  const res = await castAnonVote(c.env.DB, r.id, aid, await ipHash(c.req.header("cf-connecting-ip"), c.env.SESSION_SECRET), v as -1 | 0 | 1, {
    perAnonDay: Number(c.env.ANON_PER_ID_DAY || 30), perIpDay: Number(c.env.ANON_PER_IP_DAY || 60), perIpNewIds: Number(c.env.ANON_NEW_IDS_PER_IP || 5),
  });
  if (wantsJson(c)) return c.json({ ok: res.ok, crowd: true, error: res.ok ? undefined : res.reason, crowd_up: res.crowd_up, crowd_down: res.crowd_down, score: r.score, mine: res.mine, login: res.ok ? undefined : "/auth/github" }, res.ok ? 200 : 429);
  return c.redirect(`/r/${r.full_name}?flash=${encodeURIComponent(res.ok ? "Counted with the crowd. Log in to vote for real." : res.reason ?? "")}`);
});

pages.post("/r/:owner/:name/vote", requireUser, async (c) => {
  const user = c.get("user")!;
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  if (r.status !== "listed") return c.json({ error: "not yet graded: voting opens once the repo is listed", status: r.status }, 409);
  if (!user.canWrite) return c.json({ error: `account too new to vote (needs ${c.env.MIN_ACCOUNT_AGE_DAYS} days or a public repo)` }, 403);
  const b = await body(c);
  const v = Number(b.value);
  if (![1, -1, 0].includes(v)) return c.json({ error: "value must be 1, -1, or 0" }, 400);
  if (!(await rateLimit(c.env.DB, `vote:${user.id}`, 60, 600))) return c.json({ error: "slow down" }, 429);
  const updated = await castVote(c.env.DB, user.row, r, v as -1 | 0 | 1, await ipHash(c.req.header("cf-connecting-ip"), c.env.SESSION_SECRET));
  if (updated.ring) await logAction(c.env.DB, { actor: "system", role: "system", action: "vote-ring-flag", targetType: "repo", targetId: r.id, label: r.full_name, note: updated.ring });
  if (wantsJson(c)) return c.json({ ok: true, score: updated.score, up: updated.up, down: updated.down, mine: v });
  return c.redirect(c.req.header("referer")?.startsWith(new URL(c.req.url).origin) ? c.req.header("referer")! : `/r/${r.full_name}`);
});

pages.post("/r/:owner/:name/comments", requireUser, async (c) => {
  const user = c.get("user")!;
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  if (r.status !== "listed") return c.json({ error: "comments open once the repo is listed", status: r.status }, 409);
  if (!user.canWrite) return c.json({ error: "account too new to comment" }, 403);
  const b = await body(c);
  const text = (b.body ?? "").trim();
  if (!text || text.length > 4000) return c.json({ error: "body must be 1–4000 chars" }, 400);
  if ((text.match(/https?:\/\//g) ?? []).length > 2) return c.json({ error: "at most 2 links per comment" }, 400);
  if (!(await rateLimit(c.env.DB, `comment:${user.id}`, 10, 600))) return c.json({ error: "slow down" }, 429);
  const parent = b.parent_id ? Number(b.parent_id) : null;
  // Llama Guard on the comment (≈2 neurons) when the budget allows; flagged comments are held for a human, never dropped.
  let hold: { reason: string; guard: string } | undefined;
  const budget = await budgetAllows(c.env.DB, c.env, 5);
  if (budget.ok) {
    const g = await llamaGuard(c.env, text);
    if (g.neurons) await spendNeurons(c.env.DB, g.neurons);
    if (g.ran && !g.safe) hold = { reason: `Llama Guard: ${g.categories.join(",") || "unsafe"}`, guard: JSON.stringify(g) };
  }
  const id = await addComment(c.env.DB, r.id, user.id, parent, text, renderMarkdown(text), hold);
  if (hold) {
    await c.env.DB.prepare("INSERT OR IGNORE INTO reports (target_type, target_id, user_id, reason, note) VALUES ('comment', ?, ?, 'objectionable', ?)").bind(id, user.id, `auto: ${hold.reason}`).run();
    if (wantsJson(c)) return c.json({ ok: true, id, held: true, message: "Held for a moderator: the content check flagged it." }, 202);
    return c.redirect(`/r/${r.full_name}?flash=${encodeURIComponent("Held for a moderator: the content check flagged it. It will appear if approved.")}#comments`);
  }
  if (wantsJson(c)) return c.json({ ok: true, id, url: `/r/${r.full_name}#c${id}` }, 201);
  return c.redirect(`/r/${r.full_name}#c${id}`);
});

pages.post("/c/:id/vote", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const cm = await c.env.DB.prepare("SELECT c.id, r.full_name FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.id = ?").bind(id).first<{ id: number; full_name: string }>();
  if (!cm) return c.json({ error: "unknown comment" }, 404);
  const v = Number((await body(c)).value);
  if (![1, -1, 0].includes(v)) return c.json({ error: "value must be 1, -1, or 0" }, 400);
  const res = await castCommentVote(c.env.DB, user.id, id, v as -1 | 0 | 1);
  if (wantsJson(c)) return c.json({ ok: true, ...res, mine: v });
  return c.redirect(`/r/${cm.full_name}#c${id}`);
});

const REASONS = new Set(["objectionable", "undisclosed", "malware", "spam", "not-slop", "other"]);
async function fileReport(c: Context<AppEnv>, targetType: "repo" | "comment", targetId: number, backTo: string) {
  const user = c.get("user")!;
  const b = await body(c);
  const reason = REASONS.has(b.reason) ? b.reason : "other";
  const note = (b.note ?? "").slice(0, 300);
  if (!(await rateLimit(c.env.DB, `report:${user.id}`, 10, 3600))) return c.json({ error: "slow down" }, 429);
  const ins = await c.env.DB.prepare("INSERT OR IGNORE INTO reports (target_type, target_id, user_id, reason, note) VALUES (?,?,?,?,?)").bind(targetType, targetId, user.id, reason, note).run();
  if (ins.meta.changes && targetType === "repo") {
    const threshold = Number(c.env.AUTO_HIDE_REPORTS || 3);
    const cnt = await c.env.DB.prepare("UPDATE repos SET report_count = (SELECT count(*) FROM reports WHERE target_type = 'repo' AND target_id = ? AND resolved_at IS NULL) WHERE id = ? RETURNING report_count, status").bind(targetId, targetId).first<{ report_count: number; status: string }>();
    if (cnt && cnt.report_count >= threshold && cnt.status === "listed") {
      await c.env.DB.prepare("UPDATE repos SET status = 'hidden', queue_reason = 'reports' WHERE id = ?").bind(targetId).run();
      await logAction(c.env.DB, { actor: "system", role: "system", action: "auto-hide", targetType: "repo", targetId, note: `${cnt.report_count} reports` });
    }
  }
  if (wantsJson(c)) return c.json({ ok: true, duplicate: !ins.meta.changes });
  return c.redirect(`${backTo}?flash=${encodeURIComponent("Reported. Quietly. Thank you.")}`);
}
pages.post("/r/:owner/:name/report", requireUser, async (c) => {
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  return fileReport(c, "repo", r.id, `/r/${r.full_name}`);
});
pages.post("/c/:id/report", requireUser, async (c) => {
  const id = Number(c.req.param("id"));
  const cm = await c.env.DB.prepare("SELECT c.id, r.full_name FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.id = ?").bind(id).first<{ id: number; full_name: string }>();
  if (!cm) return c.json({ error: "unknown comment" }, 404);
  return fileReport(c, "comment", id, `/r/${cm.full_name}`);
});

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) (out[key(x)] ??= []).push(x);
  return out;
}

export { escapeHtml };
