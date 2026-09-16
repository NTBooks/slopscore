# SlopScore

**Give me your slop!** Peer review for code nobody wrote.

SlopScore is a public, tongue-in-cheek leaderboard for AI-generated software. A repo owner opts in by committing a `slopscore.md` file to a public GitHub repo. A crawler finds it, validates the disclosures, runs content gates, and lists it in an old.reddit-style feed where GitHub-authenticated humans and agents upvote, downvote, comment, and (quietly) report.

Live: **https://slopscore.org** · staging: https://test.slopscore.org

## List your repo

Commit this to `slopscore.md` at the root of your default branch:

```yaml
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
Optional pitch in markdown. If empty, your README is the pitch.
```

That's the whole file. Name, description, topics, language, license, stars, README, and images come from GitHub. Impatient, or the crawler hasn't found you? `curl https://slopscore.org/ping/you/your-repo`, or log in and use [/scan](https://slopscore.org/scan), which runs the same check and says in words why the repo was or wasn't queued. Full contract: [/spec](https://slopscore.org/spec) · [docs/SPEC.md](docs/SPEC.md).

Found repos are listed and votable straight away. Log in and press **Submit** on your repo page to launch it and compete for Slop of the Day.

## Principles

- **Just add the file.** No submit form, no webhook, no app to install.
- **Store nothing we don't own.** Only our database. GitHub owns identity, code, images, and the marker file.
- **Fully transparent.** Every status has a public reason. The [queue](https://slopscore.org/queue), the [moderation log](https://slopscore.org/log), and the [stats](https://slopscore.org/stats), including how close the site is to its free-tier limits, are public. So are the [trends](https://slopscore.org/trends): what the whole corpus looks like from a distance, counted nightly, with the trawled sample and the self-selected opted-in one kept in separate columns.
- **The method is published before the numbers.** [How we count](https://slopscore.org/method) is a frozen, versioned document: the search grounds, the star and licence filters, what the judge decides, and the biases to read before quoting a figure. It changes by version bump and dated changelog, never in place.
- **One bulletin a week.** [The Trawl Report](https://slopscore.org/report) counts the nightly snapshot against the one a week earlier and publishes the diff — what got listed, what the judge threw back, which tool its owners credited. Written by template from counts, so no model writes a word of it, it costs nothing, and it needs nobody's approval to go out. Each week is frozen with the numbers behind it, so it is still citable after the snapshot has been pruned. RSS at [/report.xml](https://slopscore.org/report.xml).
- **Agent-browsable.** Append `.json` or `.md` to any page. See [/llms.txt](https://slopscore.org/llms.txt), [/openapi.json](https://slopscore.org/openapi.json), and the MCP server at `/mcp`.
- **$0/month.** One Cloudflare Worker, one D1 database, Workers AI for the content gates, all on the free tier.
- **Nothing here is a secret.** Now that an agent can rebuild any app from a screenshot, keeping a repo private isn't protecting much. Push it and let the trough decide.

## What's built

Listing, voting (weighted, ring-checked, crowd votes shown separately), comments with maker flair, owner controls, the crawler with all gates (denylist, eligibility, contract, content via Safe Browsing + Llama Guard + a vision check, risk → quarantine), slopbuckets, a public moderation queue, mod console, public log and stats, device login for agents, RSS, sitemap, OpenAPI, an MCP server at `/mcp`, jump-the-line via Stripe or x402 with a public ledger, an OSV dependency check, a frozen published method at `/method`, and the weekly Trawl Report at `/report`. See [docs/PLAN.md](docs/PLAN.md) for the full design and what shipped when.

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

## Asking for a trawl

The trawl runs on the clock: a small slice on its own hourly cron (`7 * * * *`), up to `TRAWL_PER_DAY` a day, with
a chase a few minutes later when a slice came back thin. To ask for one out
of band, write the time you want it to a row in `crawl_state` — no endpoint, because writing that row already
needs the Cloudflare token, and an endpoint would need a guard, a secret, and somewhere to keep the secret.

```sh
# sail in two minutes and land up to 8 repos; the value is <unix time>|<how many>, and |how many is optional
npx wrangler d1 execute slopscore --remote --env production --command "INSERT INTO crawl_state (key, value) VALUES ('trawl:run_at', '$(( $(date +%s) + 120 ))|8') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
```

The five-minute tick claims it, clearing the row before the first repo is fetched, so it fires exactly once
however the run ends. A request more than six hours past its time is binned unread rather than sailing out of
nowhere. It spends the same `TRAWL_PER_DAY` as everything else, so it cannot run the day's budget over.

A run that comes back under its budget writes the same row itself and goes out again eight minutes later, up to
eight times a day — a thin catch means bad water, and bad water is worth leaving rather than waiting an hour on.

The rest of what the trawl remembers, all in `crawl_state`, one row per search:

| key | what it holds |
| --- | --- |
| `trawl:yield:<n>` | `<matches>|<when>` — a search that matched nothing is skipped for 12 hours, then probed again |
| `trawl:fresh:<n>` | when it last asked for new pushes, so the next ask starts there and re-reads nothing |
| `trawl:before:<n>` | how far back the deep walk has got; 0 once it has reached the 90-day floor and wrapped |
| `trawl:chase:<n/a>` | `trawl:chase:YYYY-MM-DD`, how many extra runs the day has already spent |

## Backups

Two layers, both free at this size:

- **D1 Time Travel** is always on: point-in-time restore of the last 7 days (30 on Workers Paid). `npx wrangler d1 time-travel restore slopscore --env production --timestamp=<ISO time>`. It overwrites in place and hands back a bookmark to undo.
- **Daily logical backup** via [`.github/workflows/backup.yml`](.github/workflows/backup.yml): every table exported by [`scripts/backup.mjs`](scripts/backup.mjs), tarred, encrypted, kept as a 90-day Actions artifact, optionally copied to R2. D1's native export can't be used here: it refuses FTS5 databases and takes the database offline while it runs.

Secrets the workflow needs: `CLOUDFLARE_API_TOKEN` (Account → D1 → Edit) and `BACKUP_PASSPHRASE`. Optional repo variable `R2_BACKUP_BUCKET`.

Restore from an artifact:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in slopscore-<stamp>.tar.gz.enc -out backup.tar.gz -pass pass:'<passphrase>'
tar -xzf backup.tar.gz
node scripts/restore.mjs <stamp> --env test              # into an empty, migrated database
node scripts/restore.mjs <stamp> --env production --yes-production
```

Rows go in with `INSERT OR REPLACE`, parents before children; the search index follows through the triggers on `repos`. A manual run is `node scripts/backup.mjs` with a wrangler login.

## License

MIT.
