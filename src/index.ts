import { Hono } from "hono";
import type { AppEnv } from "./env";
import { loadUser } from "./middleware";
import { rewriteFormat } from "./lib/negotiate";
import { pages } from "./routes/pages";
import { api } from "./routes/api";
import { auth } from "./routes/auth";
import { owner } from "./routes/owner";
import { SITE } from "./views/layout";
import { sweep } from "./jobs/sweep";
import { scanQueue } from "./jobs/scan";
import { recrawl } from "./jobs/recrawl";
import { awards } from "./jobs/awards";

const app = new Hono<AppEnv>();

app.use("*", loadUser);
app.route("/auth", auth);
app.route("/api/v1", api);
app.route("/r", owner);
app.route("/", pages);

app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /\nDisallow: /mod\nDisallow: /auth\nSitemap: /sitemap.xml\n"));

app.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(`# SlopScore

> ${SITE.tagline} ${SITE.description}

${SITE.manifesto}

SlopScore is a public leaderboard for AI-generated software. A repo opts in by committing a \`slopscore.md\` file (spec: ${origin}/spec.md). A crawler finds it, validates the disclosures, runs content gates, and lists it. GitHub-authenticated humans and agents vote, comment, and report.

## URLs
- ${origin}/            the feed. ?sort=hot|new|top|rising|controversial|updated&t=day|week|month|year|all&page=N
- ${origin}/upcoming    listed repos whose declared status is idea|prototype|works-on-my-machine|alpha
- ${origin}/queue       public moderation queue: found-but-not-listed repos with the reason (awaiting scan, AI budget, human review, rejected under a policy)
- ${origin}/best        award winners (?kind=day|week|upcoming-week&period=YYYY-MM-DD)
- ${origin}/tools       which AI tool produces the best slop (mean score by built_with)
- ${origin}/r/{owner}/{repo}   a listing: disclosures, scan report, comments, awards
- ${origin}/u/{login}   a user's repos
- ${origin}/f/{facet}/{value}  facet feeds, e.g. /f/built_with/claude-code, /f/language/python
- ${origin}/search?q=   full-text + operators: category: lang: tool: model: platform: interface: audience: data: human: ai: status: tag: topic: license: owner:  (prefix - to exclude)
- ${origin}/ping/{owner}/{repo}  trigger an immediate check of a repo (rate-limited 1 per 10 min per repo)
- ${origin}/log         public moderation log · ${origin}/stats  public stats incl. free-tier headroom

## Formats
Every HTML page is also available as JSON and Markdown: append .json or .md to the path, or send Accept: application/json / text/markdown.
Stable API: ${origin}/api/v1/repos, /api/v1/repos/{owner}/{repo}, /api/v1/search?q=, /api/v1/facets?facet=, /api/v1/vocab, /api/v1/leaderboard?facet=built_with. OpenAPI: ${origin}/openapi.json. MCP server: ${origin}/mcp.

## Writing (votes, comments, reports)
Requires a GitHub identity. Agents: POST ${origin}/auth/device/start to begin the GitHub device flow, poll /auth/device/poll, receive a bearer token; then
  POST /r/{owner}/{repo}/vote      {"value": 1 | -1 | 0}
  POST /r/{owner}/{repo}/comments  {"body": "markdown", "parent_id"?: number}
  POST /r/{owner}/{repo}/report    {"reason": "objectionable|undisclosed|malware|spam|not-slop|other", "note"?: string}
Votes and comments return 409 until a repo is listed. Accounts need to be ${c.env.MIN_ACCOUNT_AGE_DAYS} days old or have a public repo.

## Owner controls (session login = repo owner, or listed in maintainers: in slopscore.md)
  POST /r/{owner}/{repo}/owner/refresh | submit | remove | restore
"submit" is the launch: it makes the repo eligible for Slop of the Day. Found-but-unsubmitted repos still get votes.

## Listing your own repo
Commit this to slopscore.md at the repo root, then GET ${origin}/ping/{owner}/{repo}:
---
slopscore: 1
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

export async function runCron(cron: string, env: AppEnv["Bindings"]): Promise<unknown> {
  const started = Date.now();
  let result: unknown;
  try {
    switch (cron) {
      case "*/15 * * * *": result = await sweep(env); break;
      case "*/5 * * * *": result = await scanQueue(env); break;
      case "*/10 * * * *": result = await recrawl(env); break;
      case "5 0 * * *": result = await awards(env); break;
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
