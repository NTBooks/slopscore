import { Hono } from "hono";
import type { AppEnv } from "./env";
import { loadUser, secure, tripwire } from "./middleware";
import { rewriteFormat } from "./lib/negotiate";
import { homeUrl, isPreviewHost, siteOrigin, SECONDARY_REDIRECT } from "./lib/host";
import { pages } from "./routes/pages";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { owner } from "./routes/owner";
import { mod } from "./routes/mod";
import { feeds } from "./routes/feeds";
import { mcp } from "./routes/mcp";
import { pay } from "./routes/pay";
import { contact } from "./routes/contact";
import { takedown } from "./routes/takedown";
import { scan } from "./routes/scan";
import { orphanage } from "./routes/orphanage";
import { agents } from "./routes/agents";
import { disclosure } from "./routes/disclosure";
import { quiz } from "./routes/quiz";
import { flagOn, setFlags } from "./lib/flags";
import { sortOn, visibleSorts } from "./lib/db";
import { SITE } from "./views/layout";
import { sweep } from "./jobs/sweep";
import { scanQueue } from "./jobs/scan";
import { recrawl } from "./jobs/recrawl";
import { awards } from "./jobs/awards";
import { trawl, trawlOne, trawlDaily, releaseBacklog, autoTrawl, claimTrawlRequest, HOURLY_TRAWL } from "./jobs/trawl";
import { runCritics } from "./jobs/critics";
import { CRITIC_SLOT, criticForSlot, inFrenzy } from "./lib/critics";
import { snapshotTrends } from "./jobs/trends";
import { scout } from "./jobs/scout";
import { newsletter, writeReport } from "./jobs/report";
import { recordCron, noteRun, everySeconds, type AnyJob } from "./lib/crawlclock";
import { lookout } from "./jobs/lookout";
import { sweepTripwire } from "./lib/tripwire";
import { settleTakedowns } from "./lib/virtual";
import { indexNowKey } from "./lib/indexnow";

const app = new Hono<AppEnv>();

// Any domain that is not home sends you home, path and query intact (src/lib/host.ts). This runs before the
// www rule below so a www secondary domain is one hop, not two -- and, just as important, so the marketing
// domain never hands out a permanent redirect (the www rule's 301) that a browser would cache for ever. It
// also means the OAuth callback, the session cookie and the canonical URL only ever exist on one hostname.
// The order is pinned by test/app.test.ts; the two blocks are not interchangeable.
app.use("*", async (c, next) => {
  const home = homeUrl(c.req.raw, c.env);
  return home ? c.redirect(home, SECONDARY_REDIRECT) : next();
});

// One host, one copy. www and the apex both resolve to this worker; letting both answer splits every
// link and every crawl budget in two, so www redirects permanently to the canonical apex.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (!url.hostname.startsWith("www.")) return next();
  url.hostname = url.hostname.slice(4);
  return c.redirect(url.toString(), 301);
});

app.use("*", secure);
app.use("*", loadUser);
app.use("*", tripwire);
app.route("/auth", auth);
app.route("/api/v1", api);
app.route("/r", owner);
app.route("/r", takedown);
app.route("/mod", mod);
app.route("/", feeds);
app.route("/mcp", mcp);
app.route("/", pay);
app.route("/contact", contact);
app.route("/scan", scan);
app.route("/orphanage", orphanage);
app.route("/home", orphanage);
app.route("/but-is-it-slop", quiz);
app.route("/is-it-slop", quiz);
app.route("/", agents);
app.route("/", disclosure);
app.route("/", pages);

app.get("/robots.txt", (c) => {
  const url = new URL(c.req.url);
  const origin = siteOrigin(c.req.raw, c.env);
  // The test environment and preview deploys are copies of the site with their own database. Indexing one
  // would put a second, staler version of every page beside the real one, so they refuse every crawler.
  if (isPreviewHost(url.hostname)) return c.text("User-agent: *\nDisallow: /\n", 200, { "cache-control": "public, max-age=3600" });
  // Disallowed paths are either side-effecting (/ping runs a scan), private (/mod, /auth, /me),
  // or an endless duplicate of the feed (/search). Everything a reader would want stays open.
  const rules = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /mod",
    "Disallow: /auth",
    "Disallow: /me",
    "Disallow: /ping/",
    "Disallow: /search",
    "Disallow: /badge/",
    "",
    "# Agents: read /llms.txt and /api/v1/digest instead of crawling page by page.",
    "User-agent: GPTBot",
    "User-agent: ClaudeBot",
    "User-agent: Claude-Web",
    "User-agent: PerplexityBot",
    "User-agent: Google-Extended",
    "User-agent: CCBot",
    "User-agent: Applebot-Extended",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ];
  return c.text(rules.join("\n") + "\n", 200, { "cache-control": "public, max-age=3600" });
});

// IndexNow ownership proof: the engines fetch /{key}.txt and expect the key back as the whole body.
app.get("/:file{[A-Za-z0-9-]{8,128}\\.txt}", (c, next) => {
  const key = indexNowKey(c.env);
  return key && c.req.param("file") === `${key}.txt` ? c.text(key) : next();
});

app.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(`# SlopScore

> ${SITE.tagline} ${SITE.description}

${SITE.manifesto}

SlopScore is a public leaderboard for AI-generated software. A repo opts in by committing a \`slopscore.md\` file (spec: ${origin}/spec.md). A crawler finds it, validates the disclosures, runs content gates, and lists it. GitHub-authenticated humans and agents vote, comment, and report.

## URLs
- ${origin}/            the feed. ?sort=${visibleSorts().filter((s) => s !== "upcoming").join("|")}&t=day|week|month|year|all&page=N
${sortOn("upcoming") ? `- ${origin}/upcoming    listed repos whose declared status is idea|prototype|works-on-my-machine|alpha
` : ""}- ${origin}/upvoted     everything the logged-in slopsmith upvoted, newest vote first (login)
- ${origin}/queue       public moderation queue: found-but-not-listed repos with the reason (awaiting scan, AI budget, human review, rejected under a policy)
- ${origin}/best        award winners (?kind=day|week|upcoming-week&period=YYYY-MM-DD)
- ${origin}/tools       which AI tool produces the best slop (mean score by built_with)
- ${origin}/r/{owner}/{repo}   a listing: disclosures, scan report, comments, awards
- ${origin}/u/{login}   a user's repos
- ${origin}/me          my repos (login): everything you own or maintain, in any status
- ${origin}/b            slopbucket directory (subreddit-style); ${origin}/b/{bucket} a bucket feed. Declare up to 3 with slopbucket: [...] in slopscore.md; unknown buckets are created
- ${origin}/f/{facet}/{value}  facet feeds, e.g. /f/built_with/claude-code, /f/language/python
- ${origin}/search?q=   full-text + operators: category: lang: tool: model: platform: interface: audience: data: human: ai: status: tag: topic: license: owner:  (prefix - to exclude)
- ${origin}/ping/{owner}/{repo}  trigger an immediate check of a repo (rate-limited 1 per 10 min per repo)
- ${origin}/scan        same thing as a form for logged-in humans; POST {repo} with a session or bearer token, answers in words why the repo was or was not queued
- ${origin}/feed.xml    RSS of new opted-in listings (?sort=updated for ones whose file changed)
- ${origin}/trawl.xml   RSS of the trawl alone: repos the Cap'm found rather than ones that were submitted. Kept out of /feed.xml on purpose, so watching the hauls does not mean taking the whole feed
- ${origin}/log         public moderation log · ${origin}/stats  public stats incl. free-tier headroom
- ${origin}/trends      what the corpus looks like from a distance: languages, tools, categories, and what the trawl threw back, counted nightly and split into the trawled sample and the self-selected opted-in one. .json is the whole snapshot as data
- ${origin}/method      how every number on this site is made: the sample, the filters, the judge, and the known biases. Versioned and frozen; reports stamp the version they were written under. Read this before quoting a figure
- ${origin}/report      the Trawl Report: one bulletin a week, counted from the nightly snapshot, no model involved. /report is the latest and the archive, /report/{YYYY-Www} is one week, .json is the numbers it was written from, /report.xml is the feed${newsletter(c.env) ? ` and it is mailed weekly from ${newsletter(c.env)!.url}` : ""}
- ${origin}/disclosure  what slopscore.md is as an AI-provenance disclosure, and what each field declares. Read this if the question is "how do I say a model wrote this repo" rather than "where do I post it"
- ${origin}/but-is-it-slop  a seven-question questionnaire for a human who is not sure whether their own repo counts. Ends with a slopscore.md drafted from the answers
- ${origin}/for-agents  how to hand SlopScore to an agent: the skill, a rules snippet for CLAUDE.md / AGENTS.md, what needs a token and what doesn't
- ${origin}/skill.md    the skill itself: everything an agent must do to list a repo, in one file. Valid as a drop-in SKILL.md. Read this one if you are an agent holding a commit bit.
- ${origin}/contact     contact form (GitHub login) · legal/abuse notices: ${c.env.ABUSE_EMAIL ?? "abuse@slopscore.org"}

## Formats
Every HTML page is also available as JSON and Markdown: append .json or .md to the path, or send Accept: application/json / text/markdown.
Stable API: ${origin}/api/v1/digest (every listed repo in one cached file; read it instead of crawling), ${origin}/api/v1/repos, /api/v1/repos/{owner}/{repo}, /api/v1/search?q=, /api/v1/facets?facet=, /api/v1/vocab, /api/v1/leaderboard?facet=built_with. OpenAPI: ${origin}/openapi.json. MCP server: ${origin}/mcp.

## Writing (votes, comments, reports)
Requires a GitHub identity. Agents: POST ${origin}/auth/device/start → {device_code, user_code, verification_uri, interval}; show the user the code; POST ${origin}/auth/device/poll {"device_code"} every 'interval' seconds until {token} (202 while pending); then
  POST /r/{owner}/{repo}/vote      {"value": 1 | -1 | 0}
  POST /r/{owner}/{repo}/comments  {"body": "markdown", "parent_id"?: number}
  POST /r/{owner}/{repo}/report    {"reason": "objectionable|undisclosed|malware|spam|not-slop|other", "note"?: string}
Votes and comments return 409 until a repo is listed. Without a login, POST /vote counts as an anonymous "crowd" vote: shown next to the score, capped by that repo's visitors, never part of ranking or awards. Accounts need to be ${c.env.MIN_ACCOUNT_AGE_DAYS} days old or have a public repo.

## Trawled listings
Repos with "source": "trawl" never opted in. The Cap'm picked them by reading their READMEs (the owner says it was vibe coded or built with an AI tool; permissive license) and wrote their paperwork from GitHub data. They sort below opted-in repos, stay out of the RSS feed, and never win awards. Owners replace the paperwork by committing slopscore.md and pressing Refresh, or remove the listing. Anyone may POST /r/{owner}/{repo}/takedown {"message"} without a login; the listing is hidden right away and deleted for good three days later unless a moderator restores it.

## Jump the line (paid, optional)
Agents: POST ${origin}/r/{owner}/{repo}/rush returns 402 with an x402 'accepts' block (USDC on Base); pay and retry with X-PAYMENT. Humans: log in as the owner and press "Jump the line · $5" (Stripe). Both buy the wait only, never a gate, vote, or award; every payment is in the public log and the ledger on /stats.

## Owner controls (session login = repo owner, or listed in maintainers: in slopscore.md)
  POST /r/{owner}/{repo}/owner/refresh | submit | remove | restore
"submit" is the launch: it makes the repo eligible for Slop of the Day. Found-but-unsubmitted repos still get votes.

## Listing your own repo
Commit this to slopscore.md at the repo root, then GET ${origin}/ping/{owner}/{repo}. Agents: the step-by-step is at ${origin}/skill.md.
---
slopscore: 2
spec: https://slopscore.org/spec
ai_generated: entirely
human_touch: light
content_rating: everyone
contains: []
category: [cli]
status: works-on-my-machine
---
`);
});

app.notFound((c) => c.text("404. No slop here.", 404));
app.onError((err, c) => {
  console.error(err);
  return c.text(`500. The trough overflowed: ${err.message}`, 500);
});

/**
 * Run one job, record how it went, and never let it take its neighbours down.
 *
 * The daily tick used to be a single object literal, so a throw in awards silenced trawl, critics and
 * trends with it and the only trace was a console.log. Each job now carries its own guard and its own
 * heartbeat, which is what makes /queue able to answer "did that run, and did it work?".
 *
 * noteRun failing is never allowed to fail the job: the bookkeeping is worth less than the work.
 */
async function step<T>(env: AppEnv["Bindings"], job: AnyJob, fn: () => Promise<T>): Promise<T | { error: string }> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await noteRun(env.DB, job, Math.floor(Date.now() / 1000), Date.now() - t0).catch(() => {});
    return r;
  } catch (e) {
    const why = (e as Error).message;
    await noteRun(env.DB, job, Math.floor(Date.now() / 1000), Date.now() - t0, why).catch(() => {});
    return { error: why };
  }
}

/**
 * The critics' turn on a sweep tick.
 *
 * One critic at a time, rotating, so the balcony has something new every quarter of an hour instead of
 * twenty verdicts at midnight and silence after. In the last hour of the UTC day the rota is suspended
 * and the whole cast reads on every tick, which is what spends an allowance that would otherwise expire
 * unused — a review not written today cannot be written tomorrow, because tomorrow has its own cap.
 *
 * `every` is the deployed cron's own interval, so the test environment's half-hour tick still gives all
 * four a turn rather than the same two for ever.
 */
async function criticTurn(env: AppEnv["Bindings"], cron: string): Promise<unknown> {
  const at = Math.floor(Date.now() / 1000);
  const only = inFrenzy(at) ? undefined : [criticForSlot(at, everySeconds(cron) ?? CRITIC_SLOT).login];
  return step(env, "critics", () => runCritics(env, { only }));
}

/** The 00:05 UTC round. The trawl is not in it any more: it has its own hourly cron, and a nightly run that
 *  took whatever was left of the day left the hourly slices with nothing to land. */
async function dailyRound(env: AppEnv["Bindings"]): Promise<Record<string, unknown>> {
  return {
    awards: await step(env, "awards", () => awards(env)),
    // With `frenzy` on the cast has been reading all day and this would only find its caps spent.
    // Off, this is the whole of it, exactly as it was before the rota existed.
    critics: flagOn("frenzy") ? "per-tick" : await step(env, "critics", () => runCritics(env)),
    trends: await step(env, "trends", () => snapshotTrends(env)),
    // The tool names the trawl met and did not know, counted into candidates for /mod. No model, one mail a day at most.
    scout: await step(env, "scout", () => scout(env)),
    // After the count, never before it: the bulletin is written from the snapshot this round just took.
    report: await step(env, "report", () => writeReport(env)),
    tripwire: await step(env, "tripwire", () => sweepTripwire(env.DB).then(() => "swept")),
    // Takedowns hide a listing at once and delete it for good only after TAKEDOWN_GRACE; this is the deletion.
    takedowns: await step(env, "takedowns", () => settleTakedowns(env.DB, Math.floor(Date.now() / 1000))),
  };
}

export async function runCron(cron: string, env: AppEnv["Bindings"], opts: { n?: number; repo?: string; reason?: string; release?: number; dry?: boolean; auto?: number; force?: boolean } = {}): Promise<unknown> {
  setFlags(env.MOD_FLAGS);
  const started = Date.now();
  let result: unknown;
  try {
    await recordCron(env.DB, cron).catch(() => {}); // lets /queue show when each job runs next
    switch (cron) {
      // The sweep tick carries the lookout: the most frequent reliable cron, so a stalled job is noticed
      // within 15 minutes rather than at the next daily round.
      // Sweep first, and the critics after: a model call that hangs must never hold up the sweep's writes.
      case "*/15 * * * *": result = {
        sweep: await step(env, "sweep", () => sweep(env)),
        critics: flagOn("frenzy") ? await criticTurn(env, cron) : "nightly",
        lookout: await lookout(env).catch((e) => ({ error: (e as Error).message })),
      }; break;
      // The hourly slice, on a cron of its own. A find used to wait for 00:05 to appear, so by mid-afternoon the
      // newest thing on the front page was eighteen hours old. It then rode the sweep tick behind a minute check,
      // because the free plan allowed five cron triggers an account; the account is on Workers Paid (250), so it
      // gets its own. Seven past the hour, not on it: the other three ticks all fire at :00, and the sweep's code
      // search shares GitHub's search-rate bucket with this one.
      case "7 * * * *": result = { trawl: await step(env, "trawl", () => trawlDaily(env, HOURLY_TRAWL)) }; break;
      // The five-minute tick also answers a standing request (crawl_state trawl:run_at), so a trawl can be
      // asked for without an endpoint and lands within five minutes. Scan first: the request usually wants
      // the queue moving, and a trawl that lands repos has them scanned on the next tick anyway.
      case "*/5 * * * *": {
        const asked = await claimTrawlRequest(env, HOURLY_TRAWL);
        result = {
          scan: await step(env, "scan", () => scanQueue(env, opts.n ?? undefined)),
          trawl: asked == null ? "none asked for" : await step(env, "trawl", () => trawlDaily(env, asked)),
        };
        break;
      }
      case "*/10 * * * *": result = await step(env, "recrawl", () => recrawl(env)); break;
      case "5 0 * * *": result = await dailyRound(env); break;
      // manual only: &release=N moves N backlog picks into the queue; &repo=owner/name[&reason=...] hand-picks one; &n=N runs the keyword search
      case "trawl": result = opts.release ? await releaseBacklog(env, opts.release) : opts.auto ? await autoTrawl(env, opts.auto) : opts.repo ? await trawlOne(env, opts.repo, opts.reason) : await trawl(env, opts.n); break;
      // manual: &n=N repos per critic this run, &dry=1 to read and score without voting or recording
      case "critics": result = await runCritics(env, { n: opts.n, dry: opts.dry }); break;
      // manual: recount the dashboard now rather than waiting for 00:05. Idempotent: it replaces today's rows.
      case "trends": result = await snapshotTrends(env); break;
      // manual: count the sightings into candidates now. Idempotent: it refreshes counts and never touches a status.
      case "scout": result = await scout(env); break;
      // manual: write the week's bulletin now. &force=1 overwrites the week rather than declining it, which is
      // how the first one gets published on a day that is not a Monday.
      case "report": result = await writeReport(env, undefined, { force: Boolean(opts.force) }); break;
      // The test environment runs the same five crons as production now. Its former combined half-hour tick was
      // a second dispatch path -- a daily round at 00:00 instead of 00:05, a recrawl every 30 minutes -- so the
      // one environment meant to catch scheduling mistakes never ran production's schedule.
      default: result = { note: `unknown cron ${cron}` };
    }
  } catch (e) {
    result = { error: (e as Error).message };
  }
  console.log(JSON.stringify({ cron, ms: Date.now() - started, result }));
  return result;
}

export default {
  fetch(request: Request, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    return app.fetch(rewriteFormat(request), env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(runCron(event.cron, env));
  },
};
