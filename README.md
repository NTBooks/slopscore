# SlopScore™

**Give me your slop!** Peer review for code nobody wrote.

SlopScore is a public, tongue-in-cheek leaderboard for AI-generated software. A repo owner opts in by committing a `slopscore.md` file to a public GitHub repo. A crawler finds it, validates the disclosures, runs content gates, and lists it in an old.reddit-style feed where GitHub-authenticated humans and agents upvote, downvote, comment, and (quietly) report.

Live: **https://slopscore.org** · staging: https://test.slopscore.org

## List your repo

Commit this to `slopscore.md` at the root of your default branch:

```yaml
---
slopscore: 1
ai_generated: entirely
human_touch: light
content_rating: everyone
contains: []
category: [cli]
status: works-on-my-machine
---
Optional pitch in markdown. If empty, your README is the pitch.
```

That's the whole file. Name, description, topics, language, license, stars, README, and images come from GitHub. Impatient? `curl https://slopscore.org/ping/you/your-repo`. Full contract: [/spec](https://slopscore.org/spec) · [docs/SPEC.md](docs/SPEC.md).

Found repos are listed and votable straight away. Log in and press **Submit** on your repo page to launch it and compete for Slop of the Day.

## Principles

- **Just add the file.** No submit form, no webhook, no app to install.
- **Store nothing we don't own.** Only our database. GitHub owns identity, code, images, and the marker file.
- **Fully transparent.** Every status has a public reason. The [queue](https://slopscore.org/queue), the [moderation log](https://slopscore.org/log), and the [stats](https://slopscore.org/stats), including how close the site is to its free-tier limits, are public.
- **Agent-browsable.** Append `.json` or `.md` to any page. See [/llms.txt](https://slopscore.org/llms.txt), [/openapi.json](https://slopscore.org/openapi.json), and the MCP server at `/mcp`.
- **$0/month.** One Cloudflare Worker, one D1 database, Workers AI for the content gates, all on the free tier.
- **Nothing here is a secret.** Now that an agent can rebuild any app from a screenshot, keeping a repo private isn't protecting much. Push it and let the trough decide.

## Stack

Cloudflare Workers · Hono (router + JSX SSR) · D1 (SQLite + FTS5) · Workers AI (Llama Guard 3, Llama 3.2 Vision) · Cron Triggers · Durable Objects for MCP. No client-side framework; forms work without JavaScript.

## Development

```bash
npm install
cp .dev.vars.example .dev.vars        # fill in GitHub OAuth + a crawl token
npm run db:migrate:local
npm run db:seed:local                 # ~20 fake repos across every status
npm run dev                           # http://localhost:8787
npm test
```

Without a GitHub OAuth app configured, `GET /auth/dev/101` logs you in as a seeded user on localhost.

### Secrets (`wrangler secret put …`)

`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (OAuth app, scope `read:user`), `GITHUB_CRAWL_TOKEN` (fine-grained PAT, public read), `SESSION_SECRET`, `SAFE_BROWSING_KEY`.

### Vars (`wrangler.jsonc`)

`ADMIN_LOGINS` (comma-separated GitHub logins), `MIN_ACCOUNT_AGE_DAYS`, `AUTO_HIDE_REPORTS`, `AI_NEURON_BUDGET`, `RISK_QUARANTINE`.

## Layout

```
migrations/     D1 schema (FTS5 + triggers)
public/         style.css, favicon — the only static assets
src/index.ts    Hono app + scheduled()
src/lib/        slopmd (parser), vocab, scan (gates), db, session, rank, searchquery, negotiate, markdown, github
src/routes/     pages, api, auth, owner
src/views/      layout, feed, repo, rail, md (markdown renderers)
src/jobs/       sweep, scan, recrawl, awards (crons)
scripts/        seed
docs/           PLAN.md, SPEC.md
```

## Moderation, briefly

Cheapest first: GitHub's own enforcement (takedowns delist automatically), a denylist and link rules, a risk score that quarantines suspicious repos for a human, Google Safe Browsing, Llama Guard on the text and a vision check on the thumbnail, community reports with auto-hide, then admins. Nothing is votable until it's listed. Every action lands in the public log.

## License

MIT.
