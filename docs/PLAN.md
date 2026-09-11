# SlopScore — plan

## Context

SlopScore is a public, tongue-in-cheek leaderboard for AI-generated ("slop") software. A repo owner opts in by committing a `slopscore.md` file to a public GitHub repo. A crawler finds it, validates the disclosures inside it, runs security/content gates, and lists the repo in an old.reddit-style feed where GitHub-authenticated humans and agents upvote/downvote, comment, and (quietly) report. We store only our own DB; GitHub owns identity, code, and the marker file.

Hard requirements from the brief: GitHub login only, no hosted assets beyond the DB (plus one stylesheet), everything works by *just adding the file* (no submit form), track updates to listed repos, mandatory disclosures in the marker file or the repo is rejected, muted report button + moderation system with admins from an env var, reddit-style search and old.reddit-style feed, one-page site with attractive tongue-in-cheek art and basic instructions, $0/month on Cloudflare, fully agent-browsable.

Project root: `E:\slopscore`. Public repo: github.com/NTBooks/slopscore. Domain: **slopscore.org** (bought 2026-09-10); staging at **test.slopscore.org** as a second wrangler environment (`--env test`) with its own D1 (`slopscore-test`) so changes can be tried on real Workers before production.

Naming note: "slopscore" is already used by two unrelated tools (repo-slopscore at slopscan.ava.pet, and jman4162/slopscore, a prose linter). Neither is a review site, but expect some search-term collision.

## Research findings

**Prior art.** No one does opt-in marker + community rating + agent-first API. Vybe Guide is star-ranked discovery with no voting; Product Hunt's vibe-coding category is products not repos; repo-slopscore detects AI commits but has no reviews; slopfree-software-index is the inverse (projects that reject AI code). The niche is open.

**Free on Cloudflare, DB included: yes** (Workers Free plan, verified Sept 2026).

| Service | Free limit | Our use |
|---|---|---|
| Workers | 100k req/day, 10 ms CPU, 50 external subrequests/invocation | app + API + crawler |
| D1 (SQLite, FTS5 compiled in) | 5 GB, 5M row reads/day, 100k row writes/day, **hard-enforced since 2026-09-01** | only DB, plus full-text search |
| Cron Triggers | 5/account | sweep, scan, recrawl |
| Workers AI | 10k neurons/day (no key; bound to the Worker) | Llama Guard 3 on marker file + README, vision check on thumbnail. Llama Guard costs ~44 neurons per 1k input tokens, so text sent per scan is capped (see gates) ⇒ ~35 scans/day free; overage is $0.011/1k neurons on Workers Paid ($5/mo), ≈ $0.003 per scan |
| Durable Objects (SQLite) | 100k req/day | remote MCP server |
| Static assets, workers.dev subdomain | free | `style.css`; URL until a domain is bought (~$10/yr, only paid item, optional) |

**Tracking repo updates.** GitHub has no push feed we can subscribe to without the owner installing a webhook/App, which violates "just add the file". Two free options, both used:
- Authenticated **conditional requests** (`If-None-Match` ETag) on `GET /repos/{o}/{r}` and `GET /repos/{o}/{r}/commits?path=slopscore.md&per_page=1`. A 304 costs **zero** rate limit, so recrawling thousands of repos hourly is cheap.
- Public Atom feed `https://github.com/{o}/{r}/commits/{branch}.atom` needs no token; used as fallback if the PAT is throttled.

**Discovery.** GitHub code search API (`filename:slopscore.md path:/`, 30 req/min, ≤1000 results/query, excludes forks, indexing lags minutes-to-hours for new repos). Sufficient for a sweep; a `GET /ping/:owner/:repo` URL lets impatient authors (or agents) trigger an immediate check without any form.

## The `slopscore.md` contract (docs/SPEC.md)

Principle: **the marker file only holds what GitHub cannot tell us.** Everything GitHub already knows (name, description, website, topics, languages, license, stars, forks, release, README, contributors, community health, dependencies) is pulled from the API and never has to be repeated. A valid `slopscore.md` can be six lines.

YAML frontmatter + optional markdown body. **Missing or invalid disclosure fields ⇒ status `rejected`** with the reason shown publicly at `/r/:owner/:repo` so the author can fix and re-ping. The page exists even when rejected; that's how "just add the file" gives feedback.

```yaml
---
slopscore: 2                 # required, spec version
spec: https://slopscore.org/spec   # required, the contract's URL: credits the format and marks the file as meant for SlopScore
ai_generated: entirely       # required: entirely | mostly | partly | none  (the joke: everyone says entirely)
human_touch: light           # required: none | light | heavy — how much a human edited the output
content_rating: everyone     # required; ONLY "everyone" is listed. mature|adult ⇒ rejected
contains: []                 # required list, may be empty. Two sets:
                             #   disclosed-and-listed: crypto, financial, medical, legal, scraping, security-research, weapons-fiction, gambling-sim, mild-language
                             #   disclosed-and-rejected: nudity, sexual, gore, hate, harassment, drugs, real-weapons, malware, spam
category: [devtools, cli]    # required ≥1, controlled vocab (~30): devtools, cli, web-app, mobile, game, library, api, bot, agent,
                             #   mcp-server, data, ml, automation, iot, media, productivity, security, finance, education, science,
                             #   art, social, infra, plugin, extension, template, dataset, docs, toy, other
status: works-on-my-machine  # required: idea | prototype | works-on-my-machine | alpha | beta | stable | maintained | abandoned

# ---- Optional overrides (GitHub value is used when omitted) ----
title:                       # default: repo name
tagline:                     # default: GitHub description (≤ 140 chars; rejected only if BOTH are empty)
demo_url:                    # default: GitHub homepage

# ---- Optional facets GitHub can't detect. Lowercased, [a-z0-9.+-], aliases normalized
# (cc→claude-code, k8s→kubernetes). Unknown values never reject; kept as free tags, flagged
# "unrecognized" in the scan report so the vocabulary can grow. ----
built_with: [claude-code]    # AI tools: claude-code, claude, cursor, copilot, codex, gemini-cli, windsurf, aider, cline, chatgpt, lovable, bolt, v0, replit, other
models: [claude-fable-5-1]   # free
interface: [cli, web]        # cli | tui | web | desktop | mobile | api | library | bot | mcp | plugin | headless
frameworks: [fastapi]        # free vocab + alias table (GitHub doesn't detect frameworks)
platforms: [linux, docker]   # linux | macos | windows | android | ios | web | docker | cloudflare | aws | gcp | azure | raspberry-pi | browser
audience: [developers]       # developers | end-users | researchers | kids | enterprises | agents | me
data: [local-only]           # none | local-only | sends-telemetry | needs-api-key | stores-pii | scrapes
needs: [openai-key]          # external accounts/keys required, free
domain: [home-automation]    # free subject-matter tags
tags: []                     # free-form, ≤ 20; GitHub topics are merged in automatically as `detected`
images: []                   # optional explicit list of repo-relative image paths (overrides the auto-discovered slopscore-N.* files)
maintainers: []              # GitHub logins (besides the owner) who get owner controls on the site; the only way to manage an org-owned repo
unlisted: false              # true ⇒ delisted with reason owner-request on next check; file-only opt-out for people who never log in
x-anything: ...              # any `x-` prefixed key is preserved verbatim in meta JSON, never validated
---
Optional body: the pitch, ≤ 4000 chars markdown. If empty, the README is the pitch.
```

WIP is welcome: `status: idea|prototype|works-on-my-machine|alpha` repos are listed like any other, surface in the **up and coming** tab, and compete for the weekly "Most Promising Slop" award once submitted. Only the nine disclosure fields (`slopscore`, `spec`, `ai_generated`, `human_touch`, `content_rating`, `contains`, `category`, `status`, and a non-empty tagline from either source) can cause rejection. `slopscore: 2` versioning lets the vocab change later (v1 had no `spec:` line and is rejected with an upgrade hint). Controlled vocabularies and the alias table live in `src/lib/vocab.ts`, published at `/api/v1/vocab` and in `docs/SPEC.md`.

### What we pull from GitHub instead (per repo, all free API)
| Source | Fields used | Cost |
|---|---|---|
| `GET /repos/{o}/{r}` | name, description, homepage, **topics[]**, primary `language`, `license.spdx_id`, stars, forks, watchers, open_issues, size, created/pushed_at, archived, disabled, fork, is_template, default_branch, owner avatar/type | 1 call, ETag-cached |
| `GET /repos/{o}/{r}/languages` | bytes per language → `languages` facet with percentages (the GitHub language bar) | 1 call |
| `GET /repos/{o}/{r}/readme` with `Accept: application/vnd.github.html` | README regardless of filename/case, **already rendered and sanitized by GitHub's own html-pipeline** (we never run a markdown renderer on README); we then apply the image allowlist below; first 50 KB stored, "read more on GitHub" link | 1 call, ETag-cached |
| `POST /markdown` (`mode: gfm`, `context: o/r`) | renders the `slopscore.md` body through the same GitHub sanitizer; relative links/images resolve against the repo | 1 call, only when `md_sha` changes |
| `GET /repos/{o}/{r}/contents/` | root directory listing → discovers `slopscore-N.*` gallery images with their byte sizes, no per-file probing | 1 call, ETag-cached |
| `GET /repos/{o}/{r}/releases/latest` | latest tag + date (404 = none) | 1 call |
| `GET /repos/{o}/{r}/community/profile` | health %, has license/CoC/contributing/issue templates → "paperwork" chips | 1 call |
| `GET /repos/{o}/{r}/contributors?per_page=1&anon=1` | contributor count from `Link: last` page number | 1 call |
| `GET /repos/{o}/{r}/dependency-graph/sbom` | SPDX SBOM → OSV.dev batch lookup for the vulnerable-deps badge, no manifest parsing | 1 call |
| `https://opengraph.githubassets.com/…/{o}/{r}` | social card image, hotlinked on the repo page | 0 |

Everything above is stored in a `gh` JSON column and refreshed on recrawl; detected values land in `repo_tags` with `source=detected` so `lang:python` and `topic:x` filters work with zero author effort. Declared and detected values are both shown, labelled.

### Images (hosted on GitHub, displayed by us)
- **Works without hosting anything:** `https://raw.githubusercontent.com/{o}/{r}/{branch}/{path}` serves images with real image content types and no hotlink restrictions. We only ever emit `<img src>` pointing there (plus `opengraph.githubassets.com` for the social card). GitHub caches raw for ~5 min, so an author's image swap shows up quickly. `referrerpolicy="no-referrer"`, `loading="lazy"`, CSS-constrained sizes, no inline SVG from repos (SVG can carry scripts; SVG paths are skipped).
- **Gallery convention:** files at repo root matching `/^slop(score)?[-_]?([1-9])\.(png|jpe?g|gif|webp)$/i`, so `slopscore-1.png`, `SLOP1.png`, `slop_2.jpg` all work, ordered by N, max 6, each ≤ 3 MB (size comes from the contents listing, oversize ones are skipped and noted in the scan report). `images:` in frontmatter overrides with arbitrary repo-relative paths, same rules. Image 1 is the **feed thumbnail** (old.reddit style, 70×70) and the card image; fallback is the GitHub OpenGraph card, then the owner avatar.
- **README images:** relative `src` paths are rewritten to the raw URL on the default branch; absolute images are allowed only from `github.com`, `*.githubusercontent.com`, and `img.shields.io` (badges); anything else is stripped. GitHub-flavored `<picture>`/`<img>` HTML in READMEs goes through the same allowlist.
- **Moderation:** images are the riskiest content we display. Thumbnail (image 1) gets a Workers AI vision check at scan time (`@cf/meta/llama-3.2-11b-vision-instruct`, "safe for a general audience? yes/no + category"); a "no" rejects for undisclosed content. Gallery images 2–6 are best-effort within the daily neuron budget (checked if quota allows, else marked `image_check: skipped` and shown behind a click-to-expand). Every image on a page is covered by the same muted report button, and an admin `hide_images` action strips a repo's gallery without delisting. Recrawl re-checks only when the file's `sha` changed.

Honesty check: Llama Guard runs on body + README. If it flags a category the author did not disclose ⇒ `rejected: undisclosed content`. "Disclosed-and-listed" items render as grey chips + a one-line disclaimer on the repo page.

## Architecture

Single Cloudflare Worker, TypeScript, Hono (router + JSX SSR), raw D1 prepared statements (low CPU), `agents` SDK `McpAgent` for MCP. No client JS required; forms are plain POSTs, a few lines of JS enhance voting.

```
E:\slopscore\
  wrangler.jsonc              # D1, AI, DO bindings; 3 crons; assets dir; vars
  package.json  tsconfig.json  vitest.config.ts
  migrations/0001_init.sql    # tables + FTS5 virtual table + triggers
  public/style.css            # the only static asset
  art/*.svg                   # sources from the vector-art skill (inlined into views at build)
  src/index.ts                # Hono app + scheduled()
  src/routes/pages.tsx        # /, /r/:o/:r, /u/:login, /t/:tag, /search, /ping
  src/routes/api.ts           # /api/v1/*
  src/routes/auth.ts          # GitHub web OAuth + device flow
  src/routes/mod.tsx          # /mod queue + actions (admins only)
  src/routes/feeds.ts         # llms.txt, openapi.json, feed.xml, sitemap.xml, robots.txt, badge svg
  src/mcp.ts                  # McpAgent Durable Object at /mcp
  src/lib/{db,github,session,slopmd,vocab,scan,markdown,negotiate,rank,searchquery}.ts
  src/jobs/{sweep,scan,recrawl}.ts
  src/views/{layout,home,feed-row,repo,user,mod,login}.tsx
  test/                       # vitest + @cloudflare/vitest-pool-workers
  slopscore.md                # dogfood: the site lists itself
  docs/SPEC.md  README.md
```

### D1 schema (migrations/0001_init.sql)
- `users(id=github id PK, login, avatar_url, gh_created_at, public_repos, banned_at, created_at)` — admin status is **not** stored; it's `login ∈ ADMIN_LOGINS` env var, checked per request.
- `repos(id, full_name UNIQUE, owner, name, default_branch, title, tagline, demo_url, stars, forks, language, license, pushed_at, is_fork, archived, gh JSON (full API snapshot: description, homepage, topics, languages bytes, release, community profile, contributor count), readme_html (≤50 KB sanitized), readme_sha, images JSON ([{path, sha, size, checked}]), images_hidden INT, etag_repo, etag_readme, etag_contents, md_sha, md_updated_at, meta JSON (parsed frontmatter), body_md, status discovered|quarantined|rejected|listed|hidden|delisted, tier found|submitted, submitted_by, submitted_at, removed_at, removed_reason (404|451|dmca|disabled|tos-block|owner-request|admin), queue_reason (awaiting-scan | ai-budget | awaiting-review), risk INT, reject_reason, scan JSON (gate results incl. risk_reasons[] and denylist hits), up, down, score, hot, controversy, comment_count, report_count, first_seen, listed_at, last_crawled, next_crawl)` + indexes on (status,hot), (status,listed_at), (status,score), (status,md_updated_at), (status,first_seen), (next_crawl).
- `repo_tags(repo_id, facet, value, source declared|detected|alias, recognized INT, PK(repo_id,facet,value))` + index (facet,value) — one row per facet value, so any facet is filterable and countable; rebuilt from `meta` on every scan/recrawl.
- `repo_versions(id, repo_id, md_sha, meta JSON, body_md, stars, seen_at)` — history of every marker-file change; powers "updated" sort and a per-repo changelog.
- `votes(user_id, repo_id, value CHECK IN(-1,1), created_at, PK(user_id,repo_id))`
- `comments(id, repo_id, user_id, parent_id, body_md, up, down, deleted_at, hidden_at, created_at)`
- `reports(id, target_type repo|comment, target_id, user_id, reason enum, note, created_at, resolved_at, resolved_by, resolution)` UNIQUE(target_type,target_id,user_id)
- `mod_log(id, admin_login, action, target_type, target_id, note, created_at)` — **public** at `/log`; every admin action is visible with the admin's GitHub login.
- `denylist(term PK, kind slur|spam|domain, scope title|any, added_by, created_at)` — seeded from `src/lib/denylist/*.txt` in the public repo (vendored LDNOOBW-style word list + spam phrases + shortener/malware domains); admins can add terms from `/mod` without a redeploy.
- `stats_daily(date PK, neurons_used, neurons_budget, scans, deferred, found, listed, rejected, quarantined, reports)` — one row per UTC day, written by the crons; powers the public `/stats` page and the "time to upgrade" signal.
- `rate_limits(key PK, count, window_start)` — per-user write throttle in D1 (KV free tier is only 1k writes/day)
- `crawl_state(key PK, value)` — also holds `ai_neurons_today` + date so scan/recrawl can stop calling Workers AI before the free quota is exhausted.
- `awards(id, repo_id, kind day|week|upcoming-week, period TEXT, rank INT, score INT, created_at, UNIQUE(kind,period,rank))` — Product-Hunt-style "#1 Slop of the Day/Week", written by the awards cron, shown on the feed strip, repo page, and badge.
- `repos_fts` FTS5(title, tagline, body, tags_flat, owner, name, content=repos) with insert/update/delete triggers; `tags_flat` is every facet value joined as `facet:value` tokens so plain search also hits tags.

### Routes
| Route | Notes |
|---|---|
| `GET /` | **the one page**: hero art + 3-step instructions + the feed + search box + footer "for agents" links. `?sort=hot|new|top|rising|controversial|updated&t=hour|day|week|month|year|all&page=` |
| `GET /search?q=&sort=&t=` | FTS5 `MATCH` plus reddit-style operators, one per facet: `category:cli lang:python tool:claude-code platform:docker interface:web audience:agents data:local-only human:none tag:toast owner:x status:x license:mit`; `-facet:value` negates; unknown operators fall back to text. Parsed into `repo_tags` joins |
| `GET /t/:tag`, `GET /f/:facet/:value`, `GET /u/:login` | free-tag, facet-value, and user feeds (same feed renderer); facet pages show sibling values with counts for browsing |
| `GET /api/v1/vocab`, `GET /api/v1/facets?facet=` | controlled vocabularies + alias table; value counts per facet for building filters |
| `GET /r/:owner/:repo` | repo page: rendered body, disclosure chips, scan report, changelog, comments; also shows rejection reason when rejected |
| `GET /ping/:owner/:repo` | immediate check (rate-limited per IP + per repo to 1/10 min); returns status; works for curl/agents |
| `POST /r/:o/:r/owner/:action` | **owner controls**, session login must equal the repo owner login or be in the file's `maintainers:`. Actions: `refresh` (full re-crawl now, bypasses the ping throttle, 1/min; **a rejected repo re-enters detection here once the owner fixed the issue**, and anyone can do the same via `/ping`), `submit` (tier `found` → `submitted`: the launch; eligible for awards from that UTC day; once per 180 days), `remove` (status `delisted`, `removed_reason=owner-request`, immediate, public tombstone, written to `mod_log` as an owner action), `restore` (undo remove; re-enters the queue for a fresh scan, keeps its votes) |
| `GET /upcoming` | **up and coming**: listed repos whose declared `status` is `idea`, `prototype`, `works-on-my-machine`, or `alpha`, sorted by rising; also a tab on `/` and `/upcoming.xml` |
| `POST /r/:o/:r/vote` `{value}`, `POST /r/:o/:r/comments`, `POST /r/:o/:r/report`, `POST /c/:id/vote`, `POST /c/:id/report` | writes, session required. Vote and comment return `409 not yet graded` unless status is `listed`; report works in every status. Tier `found` repos get **pre-qualified voting**: votes and comments count and rank normally, shown with an "unclaimed" chip, but the repo is not eligible for awards or `/best` until the owner submits. Votes carry over on submit, nothing resets |
| `GET /auth/github` → `/auth/callback`, `POST /auth/device/start|poll`, `POST /auth/logout` | web OAuth (scope `read:user`, token discarded after `/user`); device flow issues a bearer for agents |
| `GET /queue` | **public moderation queue**: every repo not yet `listed` (statuses `discovered`, `quarantined`, **and `rejected`, each shown with the policy it was rejected under**) newest first, each with its `queue_reason` ("awaiting scan", "AI budget spent, resumes 00:00 UTC", "awaiting human review · risk 72"), how long it has waited, and the scan report so far. Same feed renderer with vote arrows disabled (tooltip "not yet graded"). `?status=` filter |
| `GET /log` | public `mod_log`: who did what to which repo/comment, and why. Also `/log.xml` |
| `GET /stats` | public dashboard: neurons used / budget today, scans and deferrals, queue depth, oldest queued item, 30-day history from `stats_daily`, D1 read/write estimates. Banner when queue is growing faster than it drains ("upgrade time") |
| `GET /mod`, `POST /mod/:reportId/:action`, `POST /mod/repo/:id/:action`, `POST /mod/denylist` | admins only. Report actions: `dismiss`, `hide`, `hide_images`, `delist`, `ban_user`, `delete_comment`, `restore`. Queue actions: `approve` (quarantined → listed), `reject` (with reason), `rescan`, `delist`. `report_to_github` is a prefilled link to `github.com/contact/report-content`, not a POST; GitHub removing the repo delists it on the next recrawl. Denylist: add/remove a term |
| `GET /api/v1/repos|repos/:o/:r|repos/:o/:r/comments|search|tags|me` | JSON, cursor pagination, `Link` headers |
| `GET /badge/:owner/:repo.svg` | embeddable score badge (generated, cached 10 min); `?award=1` variant renders "#1 Slop of the Day · 2026-09-10" if the repo holds one |
| `GET /best?kind=day\|week&period=` | award archive: winners per period, same feed renderer; `/best` defaults to yesterday's top 5 |
| `GET /tools` | "built with" leaderboard: every `built_with` value with listing count, mean score, best repo; group-by over `repo_tags`, cached 1 h; also `/api/v1/leaderboard?facet=built_with` |
| `/mcp`, `/llms.txt`, `/openapi.json`, `/feed.xml`, `/sitemap.xml`, `/robots.txt` | agent + discovery surface |

Every HTML route is content-negotiated: `Accept: application/json` or `.json` ⇒ JSON; `Accept: text/markdown` or `.md` ⇒ Markdown. One handler, three renderers, `Link: rel=alternate` headers on all.

### Design (one page, tongue-in-cheek)
- **Voice:** deadpan bureaucratic-meets-farm. Tagline **"Give me your slop!"**; hero slogan **"I love slop, slop slop slop, eat it up yum."**; description line "Peer review for code nobody wrote." Instructions header: "Three steps to get your slop graded." Empty state: "No slop yet. Suspicious." Rejection copy: "Rejected. Your slop lacks paperwork." Queue copy: "In the trough. Awaiting inspection." Budget copy: "The inspector has gone home for the day. Back at 00:00 UTC." Badge text: "Certified Slop · 42".
- **Manifesto strip** (on `/`, between the hero and the three steps, ≤ 60 words, same deadpan voice; also the `og:description` for `/` and the first paragraph of `/llms.txt`). Carries the site's core sentiment: *now that an AI can copy any project, keeping a repo private isn't protecting much.* Draft: "**Why public?** Any agent can rebuild your app from a screenshot by lunch. Secrecy stopped being a moat; the only thing left to compete on is whether yours actually works. So push it, add the file, and let the trough decide." Footer echoes it in one line: "Nothing here is a secret. That's the point." Ties to the transparency rules in Moderation.
- **Art (via the `vector-art` skill, sources in `art/`, inlined as SVG):** wordmark; mascot (a smug pig in a lab coat holding a clipboard, at a trough labelled `main`); hero strip of the mascot inspecting a conveyor belt of repos; three small step icons (commit file → crawler sniffs → arrows); a "Certified Slop" rubber-stamp used on repo pages and the badge; tiny report flag icon. Everything single-colour-friendly so it works in dark mode.
- **Layout:** old.reddit density. Top bar: wordmark, sort tabs (hot/new/top/rising/controversial/updated), search box, login/avatar. Sort tabs gain **upcoming**. Feed rows: rank · ▲ score ▼ · 70×70 thumbnail (gallery image 1 → OpenGraph card → avatar) · **title** (external link to GitHub) · `(github.com/owner)` · tagline · language dot + primary language · ★ stars · disclosure chips · `submitted 3 days ago by owner · 12 comments · report` where `report` is low-contrast grey and confirms via a tiny inline form (reason select + optional note). Repo page: gallery strip, About block (description, website, topics, license, language bar, latest release, contributors, community-health chips), the pitch, then the README collapsed to ~2 screens with "read more on GitHub". **Slop of the Day strip** above the feed on `/`: yesterday's #1 with thumbnail, score, and a "Certified Slop of the Day" stamp; weekly winner on Mondays. Right rail: mascot, the 3-step instructions with a copyable minimal `slopscore.md`, "for agents" box (llms.txt / API / MCP / device login), "built with" leaderboard (top 5 tools by mean score, links to `/tools`), stats. Mobile: rail collapses below feed.
- **Owner box** on `/r/:o/:r`, shown only when the session login is the owner or a listed maintainer: current tier and status in plain words, buttons `Refresh from GitHub`, `Submit for consideration` (disabled with the reason if not `listed` yet, or if submitted < 180 d ago), `Remove listing` (confirm; explains the tombstone and the `unlisted: true` file alternative), `Restore`. Also the copyable badge markdown. Nothing here requires a form for discovery; the file alone still gets a repo found, scanned, listed, and voted on. Submitting is the extra step that makes it a launch.
- **Three steps copy** becomes: 1 "Commit `slopscore.md`" · 2 "Get sniffed out and graded" (found tier: listed, votable) · 3 "Log in and submit to launch" (eligible for Slop of the Day and the weekly awards). Step 3 is optional and says so.
- **Maker flair:** comments whose `user_id` matches the repo owner's GitHub id get a `maker` chip; the owner's first top-level comment is pinned above the thread (Product Hunt's maker comment). Org-owned repos get no maker detection (membership would cost an API call); documented in SPEC.
- **Share meta:** every repo page emits OpenGraph + Twitter card tags (`og:title` = title, `og:description` = tagline, `og:image` = thumbnail → GitHub OpenGraph card → avatar, `twitter:card=summary_large_image`); `/` and `/best` use the hero art. Without this the winner badge and share links render blank on Slack/X/Discord.
- **Theme:** CSS variables, light and dark via `prefers-color-scheme`, system font stack, one accent (slop orange), ~8 KB CSS.

### Auth / session
Session = base64url(`{uid, exp}`) + HMAC-SHA256 (WebCrypto, `SESSION_SECRET`), 30 days. Cookie (`httpOnly; Secure; SameSite=Lax`) for browsers, `Authorization: Bearer` for agents, same verifier. Device flow: server polls GitHub so the GitHub token never reaches the agent; we exchange for our bearer. CSRF token on forms; bearer requests exempt. Write eligibility: account age ≥ 30 days or ≥ 1 public repo (`vars` knobs). Secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CRAWL_TOKEN` (fine-grained PAT, public read), `SESSION_SECRET`, `SAFE_BROWSING_KEY`. Vars: `ADMIN_LOGINS` (comma-separated GitHub logins), `MIN_ACCOUNT_AGE_DAYS`, `AUTO_HIDE_REPORTS`, `AI_NEURON_BUDGET`, `RISK_QUARANTINE` (default 40).

### Crons (`src/jobs/`)
1. `*/15 * * * *` **sweep** — code search `filename:slopscore.md path:/` sorted by `indexed`, ≤10 pages; unknown `full_name`s inserted as `discovered`, tier `found`.
2. `*/5 * * * *` **scan** — up to 4 `discovered` repos/run (~12 subrequests each: 8 GitHub calls, raw `slopscore.md`, Safe Browsing, Llama Guard, vision check): gates below, then `listed` or `rejected`. ≈1,150 repos/day of subrequest capacity, but **Workers AI is the real ceiling**: ~35 scans/day on the free 10k neurons (see gate 3). When `ai_neurons_today` nears the cap the cron stops early and repos stay `discovered` until the next UTC day; the repo page shows "queued for review" rather than skipping the content gate.
3. `*/10 * * * *` **recrawl** — 40 repos by `next_crawl`, one conditional `GET /repos` each. 304 ⇒ just bump `next_crawl` (free). If `pushed_at` changed ⇒ conditional README + contents + `commits?path=slopscore.md` calls; if `md_sha` changed re-parse, re-run gates, append `repo_versions`, set `md_updated_at` (feeds the "updated" sort); if gallery `sha`s changed re-check images. 404/451/archived/private/`disabled` ⇒ `delisted` (GitHub's own takedowns and DMCA notices are our backstop; recrawl notes the HTTP status in `scan`). `next_crawl` = 1 h … 7 d by staleness, **shortened to ≤ 6 h for anything in the top 100 of hot or top**, since those rows are visible even when nobody opens their page. 301 (rename/transfer) ⇒ follow, update `full_name`, keep everything. 403 with GitHub's "repository access blocked" body ⇒ `delisted`, reason `tos-block`. ≈5,700 checks/day.

**Freshness on visit (the long tail).** The cron alone can leave a removed repo visible for up to 7 days. So the repo page handler, the `.json`/`.md` variants, and the badge SVG all run a throttled check after the response is sent, via `ctx.waitUntil`: server-side so agents and curl trigger it too (no client JS). Throttle is an edge-cache key `check:/o/r` with a 1 h TTL, not a D1 write; the check is one conditional `GET /repos` (304 ⇒ free, no write). Only a real change writes rows and, if the marker changed, queues a rescan. Feed pages never trigger checks (25 rows would blow the subrequest budget). The badge matters here: every README view on GitHub fetches it through GitHub's image proxy, so popular repos self-refresh.

**Removal and tombstones.** Any delist sets `removed_at` + `removed_reason` and keeps the page as a public tombstone: "Removed from GitHub on 2026-09-10 (DMCA)" or "Removed at the owner's request"; votes and comments stay readable, nothing is votable, the row leaves every feed and the sitemap, and `/log` records it. Delisted repos get one conditional check per month; if the repo and marker are back and the owner did not remove it, it re-enters `/queue` as `discovered` (fresh scan) rather than relisting silently.
4. `5 0 * * *` **awards** — for the previous UTC day (and week, on Mondays): top 5 `listed` repos of tier `submitted` by score among those with `submitted_at` in the period (submitting is the launch day, as on Product Hunt), ties by `up`; weekly also picks the top 3 submitted repos with a WIP `status` as kind `upcoming-week` ("Most Promising Slop of the Week"); insert `awards` rows; skip periods with no candidates ("No slop yesterday. Suspicious."). ~15 row writes/day. Fourth of five free crons.

### Scan gates (`src/lib/scan.ts`), results stored in `scan` JSON and rendered on the repo page
0. **Denylist + link rules** (no API, no AI, runs first so bad repos never spend neurons): word-boundary match of the `denylist` table against title, tagline, tags, category, owner login ⇒ reject "prohibited term". The same match against body + README only *flags* (long text hits Scunthorpe false positives) and adds to risk. Links: reject on URL shorteners, IP-literal URLs, links to `.exe/.msi/.dmg/.apk/.zip/.7z`, domains in the `domain` denylist; flag Telegram/Discord invites, crypto-airdrop and "free nitro" phrases, base64 blobs, invisible Unicode or mixed-script titles.
1. **Metadata** (1 API call): public, not archived, not `disabled` (GitHub disabled it, usually for abuse ⇒ reject), not empty, owner age ≥ 7 d, fork only if stars > parent (flag).
2. **Contract**: parse frontmatter with a zod schema exactly as in SPEC.md; any failure ⇒ reject with field-level reasons. `content_rating ≠ everyone` or any `contains` value in the rejected set ⇒ reject.
2b. **Risk score** (free signals we already fetched, 0–100, stored with reasons): owner < 30 d (+20), 0 followers (+10), 0 other public repos (+10), 1 commit (+10), no detected language (+15), binaries at repo root from the contents listing (+25), README < 200 chars (+10), denylist flag in body/README (+20), stars implausible for age (+15), mixed-script or invisible-Unicode title (+20), account below the write threshold (always quarantine). `risk ≥ RISK_QUARANTINE` ⇒ status `quarantined`, `queue_reason=awaiting-review`; it stays in `/queue` until an admin approves. Below ⇒ continue to gate 3 and, if it passes, `listed`.
3. **Content**: `slopscore.md` raw + README via API (200 KB cap for regex/link checks). Reject on secret patterns (AWS/GitHub/Slack/private keys), > 30 links, any link failing Google Safe Browsing Lookup v4; Llama Guard 3 (`@cf/meta/llama-guard-3-8b`) on description + full body + README **truncated to ~16 KB (~5k tokens ≈ 230 neurons)**; thumbnail vision check (`@cf/meta/llama-3.2-11b-vision-instruct`, ~10 neurons); flagged category not disclosed ⇒ reject "undisclosed content". Neuron estimate per call is added to `ai_neurons_today` before the call; if the running total would exceed `AI_NEURON_BUDGET` (var, default 9,000) the scan defers. No external LLM keys anywhere; Workers AI is a binding.
4. **Dependencies** (badge, not gate; phase 4): SBOM from the dependency-graph endpoint → OSV.dev batch API (free, no key), show "N known-vulnerable deps".

### Moderation (layered, cheapest first, all of it public)
Every repo the crawler finds enters the **public queue** at `/queue` the moment it is discovered, before any gate runs. Nothing is votable or commentable until it is `listed`; everything is readable and reportable at every stage. Queue rows show the reason they are waiting, so the site itself displays the backlog: when the `ai-budget` bucket grows day over day, the free tier is exhausted and it is time to upgrade. `/stats` shows the same numbers plus 30 days of history.

1. **GitHub's own enforcement** (free, nothing to build): takedowns and DMCA ⇒ 404/451 on recrawl ⇒ `delisted`; the `disabled` flag ⇒ rejected; README and body HTML come from GitHub's sanitizer; avatars and logins are GitHub-moderated. The admin queue has a one-click prefilled "report to GitHub" link for anything that breaks GitHub's terms, so GitHub removes the source and we delist automatically.
2. **Denylist + link rules** (gate 0, pure CPU): reject on prohibited terms in short fields, flag in long text; shortener/IP/executable links reject. Word lists live in the public repo; admins can hot-add terms from `/mod`.
3. **Risk score ⇒ quarantine** (gate 2b, free signals): suspicious-but-not-provably-bad repos wait for a human instead of going live. Threshold is a var, so it can be tightened when reports rise.
4. **Safe Browsing + Workers AI** (gate 3, neuron-budgeted): Llama Guard on capped text, vision on the thumbnail; deferred with `queue_reason=ai-budget` rather than skipped when the free quota is spent. Comments also go through Llama Guard (≈2 neurons each) before they are stored; a flagged comment is held `hidden_at` for admin review, never silently dropped.
5. **Community reports**: report button on every feed row, queue row, repo page, image, and comment; muted styling; requires login; one report per user per target; reasons: `objectionable`, `undisclosed`, `malware`, `spam`, `not-slop`, `other` + note. `report_count ≥ AUTO_HIDE_REPORTS` (default 3 distinct users) ⇒ status `hidden` immediately, pending review. Hidden repos show an "under review" stub, stay out of feeds, and appear in `/queue?status=hidden`.
6. **Owners** (session login = repo owner, or in `maintainers:`): refresh, submit, remove, restore from the owner box; removals are immediate and public. File-only equivalent: `unlisted: true` or deleting `slopscore.md`.
7. **Admins** (`ADMIN_LOGINS`): `/mod` shows reports grouped by target and the quarantine bucket, context inline, one-click actions, every action written to `mod_log`, which is public at `/log` with the admin's login. Delist locks the repo (`status=delisted`, recrawl won't relist until an admin restores). Banned users keep their history but lose write access; their votes are excluded from score recompute. Write throttles: accounts under the age/repo threshold can't vote or comment, and their repos always quarantine.

**Transparency rules:** every status has a public reason (rejection reasons, risk reasons, denylist category hit, which gate deferred and why); the scan report is on every repo page; `mod_log` is public; `/stats` is public; the denylist sources and thresholds are in the public repo; `/llms.txt` and `/openapi.json` document the queue so agents can watch it too.

- Rank: `hot` = reddit's log10(|score|) + sign·age/45000; `controversy` = reddit's formula; recomputed in the vote handler for that row only (2 row writes per vote).

### Agent surface
Unauthenticated reads, bearer for writes, content negotiation everywhere, `/llms.txt` (site, URL scheme, SPEC, API, MCP, device login), `/openapi.json` via `@hono/zod-openapi`, MCP tools `list_repos`, `get_repo`, `search_repos`, `ping_repo`, `vote`, `comment`, `report`, `whoami`, RSS of new + updated listings, edge Cache API (60 s) on all GET reads to protect D1's read cap.

## Implementation phases

1. **Core** — `change_directory` to `E:\slopscore`; scaffold with `npm create cloudflare`, Hono, wrangler bindings, migration 0001 (incl. FTS5), session lib, GitHub web OAuth, `/ping` (raw fetch of `slopscore.md`), SPEC zod schema + parser, feed page with sorts + FTS search, repo page, user/tag pages, votes with the tier rule (pre-qualified voting for `found`), comments (maker flair + pinned maker comment), owner box + `/owner/:action` with `maintainers:` and `unlisted:` support, rank math, OpenGraph/Twitter meta on every page. HTML + JSON + Markdown renderers from the start.
2. **Art + design pass** — run the `vector-art` skill for the wordmark, mascot, hero, step icons, stamp, flag; write the copy; `style.css` light/dark; mobile check in the in-app browser.
3. **Crawler + gates** — GitHub client (ETag-aware, rate-limit headers respected), sweep/scan/recrawl crons, gates 1–3 with the neuron budget, `repo_versions` changelog, "updated" sort, delist on removal with tombstones + `removed_reason`, 301/403 handling, on-visit freshness check via `waitUntil` + badge trigger, visibility-weighted `next_crawl`, awards cron (submitted tier, `submitted_at` period, upcoming-week kind) + `/best` + Slop of the Day strip, `/tools` leaderboard, `/upcoming`.
4. **Moderation** — denylist gate + link rules, risk score + `quarantined` status, public `/queue`, `/log`, `/stats` + `stats_daily`, report endpoints + muted UI, auto-hide, `/mod` queue + actions (incl. approve/reject/rescan, report-to-GitHub link, denylist add) + `mod_log`, comment Llama Guard, bans, write throttles, 409 on votes/comments for unlisted repos.
5. **Agent surface** — negotiation middleware, llms.txt, OpenAPI, device flow, `McpAgent` at `/mcp`, feeds (incl. per-facet RSS at `/f/:facet/:value.xml`), sitemap, badge SVG with the award variant.
6. **Hardening** — OSV badge, `slopscore.md` for the project itself, README + docs/SPEC.md, deploy, secrets, watch D1 metrics for a day.

## Verification

- `wrangler dev` with `wrangler d1 migrations apply slopscore --local`; seed script inserts ~20 fake repos with varied disclosures, votes, and a rejected one.
- Contract: vitest table of good/bad frontmatter fixtures → expected status and reasons; unknown facet values must be accepted and marked unrecognized, `x-` keys must round-trip; alias normalization cases (js→javascript); secret-regex and link-count cases; query parser cases (`category:cli lang:python -tool:cursor "toast" owner:foo`).
- Facets: after seeding, `/f/built_with/claude-code` and `/api/v1/facets?facet=category` return correct counts; changing a repo's tags and recrawling replaces its `repo_tags` rows.
- GitHub pull-through: scan a real repo with a six-line `slopscore.md`; page shows GitHub's description as tagline, detected languages with percentages, topics as tags, license, README rendered with relative images rewritten to raw URLs and an off-allowlist image stripped.
- Images: fixture repo with `slopscore-1.png`, `SLOP2.jpg`, a 5 MB `slopscore-3.png`, and `slopscore-4.svg` → first two listed, third skipped for size, fourth skipped as SVG; thumbnail appears in the feed; `hide_images` removes the gallery but keeps the listing.
- Crawler: `curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"` against real GitHub with the PAT; confirm rows go `discovered → listed` (tier `found`); edit the dogfood `slopscore.md`, run the recrawl cron, confirm a new `repo_versions` row and "updated" sort position; delete the file on a test repo, confirm `delisted`.
- Negotiation: `curl -H 'Accept: application/json' /r/o/r` vs `/r/o/r.md` vs HTML return consistent data.
- Queue: a freshly swept repo appears on `/queue` as "awaiting scan" before the scan cron runs; voting on it returns 409 and the arrows are disabled in HTML; after the scan passes it leaves the queue and votes work. With `AI_NEURON_BUDGET=300` the second repo shows "AI budget spent" on `/queue` and `/stats` shows deferred=1.
- Denylist: fixture repo with a prohibited term in the tagline ⇒ rejected "prohibited term"; the same term only in the README ⇒ flagged, +20 risk, not rejected; `bit.ly` link ⇒ rejected; admin adds a term via `/mod/denylist`, `rescan` rejects a previously listed fixture.
- Risk: fixture owned by a 2-day-old account with one commit and an `.exe` at root ⇒ `quarantined`, reasons listed on the repo page and `/queue`; admin `approve` ⇒ `listed`, row in `/log`.
- GitHub sanitizer: README fetched as `vnd.github.html` contains no `<script>`; a `<img src="https://evil.example/x.png">` in the README is stripped by our allowlist; 451 on recrawl ⇒ `delisted`.
- Moderation: three test users report a repo ⇒ `hidden`; admin (login in `ADMIN_LOGINS`) sees it at `/mod`, restores it, `mod_log` has the row; non-admin gets 403.
- Auth: device flow script starts auth, prints the code, polls, votes with the bearer. Web login via the in-app browser.
- MCP: `npx @modelcontextprotocol/inspector` against `/mcp`, call `search_repos` and `vote`.
- Visual: screenshots of `/` in light/dark and mobile via the Browser pane.
- Owner controls: log in as the fixture owner ⇒ owner box visible, as another user ⇒ absent, as a login in `maintainers:` on an org repo ⇒ visible. `refresh` re-crawls immediately; `submit` sets tier `submitted` + `submitted_at`, a second `submit` within 180 d is refused; `remove` ⇒ tombstone page, gone from `/`, row in `/log`, votes still readable; `restore` ⇒ back in `/queue` with votes intact. `unlisted: true` in the file ⇒ delisted on recrawl with reason `owner-request`.
- Tiers: a tier `found` listing accepts votes and comments, shows the "unclaimed" chip, and is skipped by the awards cron; after `submit` it wins the next day's award with its existing score.
- Upcoming: fixture with `status: prototype` appears on `/upcoming` and the tab, not on `/best`; after submit it is eligible for `upcoming-week`.
- Freshness: with a stale `last_crawled`, `curl /r/o/r` returns immediately and the log shows one conditional GET after the response; a second curl within the hour makes none; make the fixture repo private ⇒ next visit delists it with a tombstone; rename the fixture ⇒ 301 followed, `full_name` updated, listing intact.
- Awards: seed two days of listings, run `__scheduled?cron=5+0+*+*+*`, confirm `awards` rows, the strip on `/`, `/best?kind=day&period=YYYY-MM-DD`, and `/badge/o/r.svg?award=1` text; a day with zero listings writes nothing.
- Maker flair: owner's comment shows the `maker` chip and is pinned; a non-owner's is not; org-owned repo shows none.
- Share meta: `curl /r/o/r | grep og:` shows title/tagline/image; fallback chain when the repo has no gallery image.
- AI budget: set `AI_NEURON_BUDGET=300`, submit three repos, confirm only one scans and the rest stay `discovered` with "queued for review"; next day they scan.
- `/tools`: counts and mean scores match a hand SQL query over `repo_tags` + `repos`.
- Deploy: `wrangler deploy`, `wrangler secret put` ×5, hit the workers.dev URL, confirm crons fire in the dashboard.

## Decisions from 2026-09-10 (after phase 1 shipped)

- **No ™.** "slopscore" is not a trademark; the wordmark is plain "SlopScore".
- **Slopsmiths.** Users are called slopsmiths wherever the copy is playful (rail stats, user pages, footer, about). "Graders" is gone.
- **Tags behave like subreddits.** `tags` table (slug, title, blurb, curated, sort) seeded in migration 0002 with ~28 curated tags for the top app categories (cli, devtools, web-app, agent, mcp-server, bot, game, automation, home-automation, …). `/t` is the directory; `/t/:tag` is a feed of every listed repo whose category, `tags:`, `domain:`, or GitHub topic equals the slug, so authors don't have to know the curated list. A tag bar above the header shows the curated tags, reddit-style. Free tags still work at `/t/:anything`.
- **Vote weighting, the Reddit way.** Only logged-in accounts vote (already true). Each vote stores a `weight` from GitHub-derived trust (`src/lib/trust.ts`): 1.0 for accounts ≥ 1 year or ≥ 10 public repos, 0.75 for ≥ 90 days, 0.5 otherwise, +0.25 for ≥ 25 followers; banned = 0. `score = round(Σ weight·value)`, `up`/`down` stay raw counts. A ring check after each vote zeroes the weight (kept for audit) when ≥ 8 votes in an hour on one repo come from accounts created the same week, or ≥ 5 from one hashed network; a `vote-ring-flag` row lands in the public log. Displayed scores above 20 are fuzzed ±2% deterministically per repo so a bot can't observe whether it counted. Per-account and per-IP rate limits stay. Knobs are public; there is no secret sauce, which is also roughly Reddit's public position ("vote fuzzing", "votes from suspicious accounts don't count", shadow-weighting rather than blocking).
- **Mascot (done 2026-09-10).** `art/mascot.py` generates `art/mascot.svg` (smug pig, lab coat, clipboard, slop on chin with drips, trough labelled main, trotters); the site uses the **head-only** variant (`art/mascot-head.svg`, first-pass face, one small slop smear + drip) as `/mascot.svg`; cropped head as `/favicon.svg`, composed OpenGraph card at `/hero.png` (from `art/og.svg`). `art/icons.py` emits the single-colour wordmark, three step icons, the Certified Slop stamp, and the report flag, inlined via a wrangler Text rule (`src/views/art.tsx`). Phase 2 stylesheet pass done: warm paper palette, serif headings, goo green, capacity box, mobile rules.
- **Gate 1 fix.** Never infer "empty repository" from GitHub `size`; brand-new repos report 0 for a while. A successful marker-file fetch proves content.

## x402: pay to jump the queue (offsets hosting)

The free tier scans ~35 repos/day. When the trough backs up, an agent or author can pay the marginal cost and skip the wait. Fair: the payer covers exactly the resource they consume, nobody else's scan gets slower, and the paid path never skips a gate, only the wait.

- **Protocol.** [x402](https://x402.org) (Coinbase's open HTTP-402 payment standard): the server answers `402 Payment Required` with a JSON `accepts` block (price, asset, network, payTo); the client signs a USDC transfer and retries with an `X-PAYMENT` header; a facilitator verifies and settles on-chain. USDC on **Base** (mainnet; Base Sepolia on test.slopscore.org). Middleware: `x402-hono` (`paymentMiddleware(payTo, routes, facilitator)`); facilitator = Coinbase CDP's hosted x402 facilitator (free), configured by URL in a var. No wallet code on our side beyond an address.
- **Route.** `POST /r/:owner/:repo/rush` (also `GET /ping/:owner/:repo?rush=1` for curl users). Price **$0.25 USDC** (var `RUSH_PRICE_USD`), roughly 80× the ~$0.003 AI cost of a scan, which is what pays the $5/mo Workers Paid plan the overage needs. Same 1-per-10-min per-repo throttle as `/ping`; the throttle check runs *before* the 402 so nobody pays for a rate-limit error.
- **What "rush" buys.** `PAID_MODE` var: `immediate` (Workers Paid: scan runs inline in the request, ignores `AI_NEURON_BUDGET`, ~12 subrequests, well inside limits) or `priority` (still on Free: the repo goes to the front of the scan queue with `queue_reason=rushed` and is scanned first when the budget resets at 00:00 UTC; the 402 body and `/llms.txt` say which mode is live so agents know what they're buying). Rushed repos that fail a gate are still rejected; the receipt says so. No refunds; the price is the cost of looking, not of being listed.
- **Transparency.** Every settled payment writes `payments(id, repo_id, payer, tx_hash, amount, network, created_at)` and a public `mod_log` row `rush-paid` with the amount and repo (payer address abbreviated). `/stats` gains a **ledger**: USDC received (30 d, all time) next to the estimated Workers/AI cost, so anyone can see whether rushes are covering hosting, over-covering it, or not. If income ever materially exceeds cost, lower the price; the point is offsetting, not profit. The site's own `slopscore.md` discloses `contains: [crypto]` for this.
- **Agent surface.** `/llms.txt` and `/openapi.json` document the 402 flow; the MCP server gets a `rush_repo` tool that surfaces the payment requirements to the calling agent rather than paying itself. Discovery: the `/ping` 429 and the queue stub on a repo page both mention the rush route and price.
- **Not in scope.** Paid votes, paid awards, paid listing, or any payment that changes a score. Rush affects wait time only.
- **Phase.** Lands with phase 5 (agent surface), after the crawler exists (phase 3) so there is a queue to jump. Prereqs: a Base wallet address for `PAY_TO`, Workers Paid for `immediate` mode. Verification: on test.slopscore.org with Base Sepolia, an unpaid `POST /rush` returns 402 with a valid `accepts` block; a paid one (x402 client CLI) returns 200 with the scan result and a `payments` row; the ledger on `/stats` shows the amount; a paid rush on a repo that fails the contract gate still returns `rejected`.

### The two lines, and what the queue page shows

- **Two FIFO lines.** `repos.priority_at` (migration 0003) is set when a jump is paid (x402 or Stripe). The scan cron and the queue page order by `priority_at IS NULL, priority_at ASC, first_seen ASC`: every paid jumper, oldest payment first, then every free repo, oldest discovery first. A new payer goes to the **bottom of the jumpers' line**, never ahead of an earlier payer, and the whole jumpers' line drains before the free line moves.
- **Mode + limits are public.** `/queue` (and `/stats`) show a capacity box: `PLAN_MODE` (free tier or paid plan), the AI neuron budget used/left today, how many free scans that is, whether paid scans are metered-unlimited (paid plan) or only front-of-line under the same ceiling (free tier), the platform's daily limits for the current mode, and the three depths (paid, free, waiting on budget). Same numbers in `.json` and `.md`, so agents can decide whether paying is worth it before they pay. On the free tier, "jump the line" is honest about buying position, not extra capacity; the 402/Checkout copy says so.

### Paid scans run on OpenRouter, not on the neuron budget

Paid jumpers (x402 or Stripe) already covered their cost, so their AI checks go to **OpenRouter** with the owner's key (`OPENROUTER_API_KEY`): Llama Guard (`OPENROUTER_GUARD_MODEL`, default `meta-llama/llama-guard-4-12b`) and the vision check (`OPENROUTER_VISION_MODEL`, default `meta-llama/llama-3.2-11b-vision-instruct`). Same output contract, same gates, zero Workers AI neurons, no free-tier ceiling: a paid scan runs immediately even while the site is on the free plan. Cost per paid scan is roughly a tenth of a cent for the text check and about a tenth of a cent for the image, so a $5 donation covers thousands. The scan report says which provider ran (`ai.provider`). The capacity box on `/queue` shows "paid scans: unlimited via openrouter" when the key is set.

**Where the money actually goes (the full cost list as of phase 3):** Workers AI neurons for free scans (the only metered runtime cost on the free plan, 10k/day); the domain (~$11/yr); Workers Paid ($5/mo) only if free-tier request/D1/cron limits are exceeded, which the stats page shows; OpenRouter per paid scan; Google Safe Browsing, GitHub API, D1, cron triggers and static assets are free at this scale. Nothing else costs money.

### Stripe: the same jump, for humans

x402 is for agents with wallets. Logged-in slopsmiths get the same thing with a card: **donate $5 toward the hosting bill and your project jumps the line.** Same rule as x402: the payment buys the wait, never a gate, a vote, or an award.

- **Flow.** Owner box on `/r/:owner/:repo` (and the queue stub) shows "Jump the line · donate $5" when the repo is `discovered` or `rejected`-then-fixed and the user owns it (owner or `maintainers:`). `POST /r/:o/:r/donate` creates a Stripe Checkout Session (`mode: payment`, fixed $5, `client_reference_id` = repo id, `metadata` = {repo_id, user_id, login}) and redirects. Success URL `/r/:o/:r?donated=1`. Stripe hosts the form; no card data touches the Worker (keeps the "no hosted assets" and PCI posture). Non-owners can still donate to the general bill via `/donate` (no queue jump; it just says thanks in the log).
- **Fulfilment.** `POST /webhooks/stripe` verifies the signature (`STRIPE_WEBHOOK_SECRET`, WebCrypto HMAC-SHA256 of the timestamped payload, tolerance 5 min), handles `checkout.session.completed`, writes a `payments` row (`provider=stripe`, `amount_cents=500`, `session_id`, `payer=login`), a public `mod_log` row `donation` ("NTBooks donated $5 · rushed owner/repo"), and rushes the repo exactly like x402 (`PAID_MODE` immediate or priority). Idempotent on `session_id`. Webhook first, then the success page just says "thanks, scanning" and polls `/r/:o/:r.json` for status.
- **Money.** Stripe's fee on $5 is ~$0.45, so ~$4.55 lands, ~1,500× the AI cost of one scan; a handful of donations a month covers Workers Paid. Ledger on `/stats` shows Stripe and USDC side by side against cost. Same "lower the price if it over-covers" rule.
- **Secrets/vars.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; vars `STRIPE_PRICE_ID` (a Price for $5 created once in the Stripe dashboard), `DONATE_USD` (default 5). Test mode keys on test.slopscore.org with Stripe's test cards.
- **Copy.** Button: "Jump the line · $5 toward the hosting bill". Receipt page: "Thanks. The inspector is back from lunch." The site's own `slopscore.md` discloses `contains: [financial]` alongside `crypto`.
- **Phase.** Phase 5 with x402; both share `payments`, the rush routine, and the ledger. Verification: Stripe CLI `stripe listen --forward-to localhost:8787/webhooks/stripe`, a test-card checkout on a queued fixture ⇒ `payments` row, log row, repo scanned (or moved to front), `/stats` ledger shows $5; replaying the same event is a no-op; a tampered signature returns 400.

## Phase 3 shipped (2026-09-10)

- `src/lib/github.ts`: ETag-aware client with rate-limit tracking, rename (301) detection, README as GitHub-sanitised HTML, contents listing, languages, latest release, community profile, contributor and commit counts from `Link: rel=last`, code search, `/markdown` rendering, raw file + raw bytes.
- `src/lib/scan.ts`: the full pipeline. Gate 0 denylist (`src/lib/denylist.ts` + vendored LDNOOBW list that only flags; spam phrases; shortener/IP/executable links reject), gate 1 metadata, gate 2 contract, gate 3 content (secret regexes, Google Safe Browsing when a key is set, Llama Guard 3 on description+body+README capped at 16 KB, vision check on image 1; Llama Guard categories mapped to `contains` disclosures in `GUARD_MAP`, S6 specialized advice only flags), gate 2b risk (`src/lib/risk.ts`) → quarantine. Neuron accounting in `crawl_state` + `stats_daily`; a scan that would overrun the budget stays `discovered` with `queue_reason=ai-budget`. Images: explicit `images:` or auto `slopscore-N.*`, ≤ 3 MB, SVG skipped.
- Crons (`src/jobs/`): sweep (code search, needs `GITHUB_CRAWL_TOKEN`), scan (4/run, paid jumpers first, budget-aware, priority cleared after the scan), recrawl (40/run, conditional GET; 304 free; rename follows; 404/451/403-blocked delist; delisted repos rechecked monthly and revived into the queue if the marker is back; hot repos ≤ 6 h), awards (day/week/upcoming-week by `submitted_at`). `runCron()` in `src/index.ts`; admin/localhost trigger `GET /__cron?cron=…`.
- Freshness on visit: repo page + badge run `checkOne()` in `waitUntil`, throttled by an edge-cache key per repo per hour. Badge at `/badge/:owner/:repo.svg` (`?award=1` variant).
- Verified on the real dogfood repo through `/ping`: 5 gates pass, Llama Guard ran (46 neurons), 9 API calls, languages/README/topics pulled. Crons run locally via `/__cron`; the sweep is a no-op until a crawl token is set.
- **Colour scheme (same day):** switched from orange/paper to the retro pig's **pink + brown** (accent `#e8669a`, brown `#8a5a30`, dark mode deep brown), because the orange read too close to Moltbook.
- Still needed from the owner: a fine-grained GitHub PAT (`GITHUB_CRAWL_TOKEN`, public repos read-only) on test and production, a Google Safe Browsing API key (free), and the GitHub OAuth app.

## Phase 4 shipped (2026-09-10)

- **Mod console** (`src/routes/mod.tsx`, admins only): reports grouped by target with the reporters and notes inline; actions dismiss / hide / restore / hide images / delist (lock) / ban owner for repos, delete / ban author for comments; quarantine bucket with approve / rescan / reject / delist / ban owner; held comments with release / delete / ban; banned slopsmiths with unban and ban-by-login; buckets and denylist. Every action writes `mod_log` (public at `/log`). A "report to GitHub" link is prefilled per target.
- **Admin locks.** `repos.locked_by` + `mod_note`: an admin hide/reject/delist sticks through scans and recrawls until an admin restores (only `byAdmin` rescans may lift it). Auto-hide on `AUTO_HIDE_REPORTS` distinct reporters stays; dismissing the reports relists an unlocked repo.
- **Comment moderation.** Every comment goes through Llama Guard (≈2 neurons) when the budget allows; flagged comments are stored with `hidden_at` + `held_reason` + the guard JSON, an automatic report is filed, and the author is told it is held. Never silently dropped.
- **Visitor counting** (`src/lib/views.ts`): `repo_views(repo_id, hour, views)`, one sampled UPDATE per repo-page view (`VIEW_SAMPLE`), pruned after 35 days by the awards cron. Chosen over Analytics Engine to keep the whole thing in D1 with no extra API token; switch to AE if writes get tight.
- **Vote-burst rule** in `castVote`: in a rolling hour, votes beyond `max(10, 0.5 × views)` are stored with weight 0 and a `vote-ring-flag` row in the public log.
- **Anonymous crowd votes** (`src/lib/anon.ts`): signed `anon` cookie; `POST /vote` without a login lands in `anon_votes`, shown as "+N crowd" next to the score, **never** in score/hot/awards. Caps: per repo per day ≤ max(3, visitors today); per anon id 30/day; per network 60/day; ≤ 5 new anon ids per network per day (all vars). Verified locally: two anonymous browsers voted, the score stayed put, the crowd count moved.
- `FRESHNESS=off` var for local dev (seed repos don't exist on GitHub and were being delisted on visit).

## Phase 5, slice 1 shipped (2026-09-10): agent surface

- **Device login** (`/auth/device/start` → `/auth/device/poll`): GitHub's device flow; the server polls GitHub and hands the agent a 90-day bearer that verifies exactly like the cookie session. The OAuth app needs "Enable Device Flow" ticked.
- **Feeds** (`src/routes/feeds.ts`): `/feed.xml` (new; `?sort=updated`), `/b/:bucket.xml`, `/f/:facet/:value.xml`, `/u/:login.xml`, `/sitemap.xml` (fixed pages + buckets + listed repos), all edge-cached.
- **OpenAPI** at `/openapi.json`, hand-written 3.1 document covering the read API, the device flow, votes, comments, reports, owner controls.
- **MCP** at `/mcp` (`src/routes/mcp.ts`): Streamable HTTP in stateless mode, plain JSON-RPC over POST, no Durable Object and no SDK dependency. Tools: list_repos, search_repos, get_repo, get_queue, list_buckets, ping_repo, whoami, vote, comment, report. Reads open; writes need the bearer. Verified with raw initialize / tools/list / tools/call.

## Phase 5, slice 2 shipped (2026-09-11): payments, mobile, truffles

- **Rush** (`src/lib/rush.ts`): one routine for both providers. Idempotent on the payment id (`payments.external_id`), sets `priority_at`, re-enters rejected repos as `discovered`, logs `donation` / `rush-paid` publicly, and either scans immediately (`immediateMode`: paid plan or OpenRouter key) or leaves the repo at the front of the line.
- **Stripe** (`src/routes/pay.ts`): `POST /r/:o/:r/donate` (owner or maintainer, logged in) creates a Checkout Session with inline price data (`DONATE_USD`, default 5) and redirects; `POST /webhooks/stripe` verifies the `Stripe-Signature` HMAC itself (5-minute tolerance, constant-time compare), handles `checkout.session.completed`, and rushes the repo. Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Button "Jump the line · $5 toward the hosting bill" in the owner box when the repo is discovered or rejected.
- **x402**: `POST|GET /r/:o/:r/rush` answers 402 with an `accepts` block (exact scheme, USDC on `X402_NETWORK`, default base-sepolia, price `RUSH_PRICE_USD` default 0.25, `payTo` = `X402_PAY_TO`); with an `X-PAYMENT` header it calls the facilitator's `/verify` then `/settle` (`X402_FACILITATOR`, default x402.org) and rushes on success, returning `X-PAYMENT-RESPONSE`. Disabled (503 with the Stripe alternative) until `X402_PAY_TO` is set.
- **Ledger** on `/stats` (and `.json`): income by provider (30 d / all time) vs an estimated monthly cost (plan, domain, AI overage, OpenRouter), and whether it's covered.
- **Mobile pass**: compact one-row header with scrollable tabs and full-width search; feed rows are vote box + stacked text (rank and thumbnail hidden); the winner strip flows inline; owner buttons full width; tables scroll; the rail drops below the feed with a smaller pig. Root cause of the "one word per line" bug: hidden thumbnail wrappers and an empty rank span still took grid cells.
- **Truffles**: the winners page title and empty state, the nav tooltip, and award chips call the picks truffles ("what Schnitzel dug up"); the word never replaces "winners" in navigation.
- Still needed from the owner: Stripe keys (test mode first, with the Stripe CLI forwarding the webhook), a Base wallet address for x402, and "Enable Device Flow" on the GitHub OAuth app.

## Phase 6 shipped (2026-09-11): hardening

- **Vulnerable dependencies** (`src/lib/osv.ts`): GitHub's dependency-graph SBOM → purls → OSV.dev batch query (≤ 1000 packages, 500 per call). Stored in `gh.vulns`, re-checked when the repo was pushed since the last check or after 7 days. Repo page shows "✓ N deps, none with known advisories" or "⚠ N of M deps have known advisories" with the top advisories in the tooltip; `.md` carries the same line. A badge, never a gate.
- Repo page About block now also shows commits, contributors, latest release, a language bar, and GitHub community-profile "paperwork" chips (all data the scan already pulled).
- `/stats` gains a **free-tier headroom** box from our own counters (neurons, scans, a rough D1 write estimate) with a link to the Cloudflare dashboard for the real meters.
- `docs/SPEC.md` regenerated from `/spec.md` (v2 with the `spec:` line). README refreshed.
- Watching the metrics for a day is the owner's job in the Cloudflare dashboard: Workers requests, D1 rows read/written, Workers AI neurons. The public `/stats` page shows the same story from the inside.

## Vote throttling v2: correlate votes with visitors (phase 4)

What the sites that solved this actually do: Reddit, HN, Product Hunt and Stack Overflow allow **no anonymous votes at all**; they lower the friction of logging in instead, then weight, fuzz, rate-limit, and ring-detect logged-in votes (already built, see `src/lib/trust.ts`). The extra layer worth borrowing is **traffic correlation**: votes should never outrun the people who could have cast them.

- **Visitor counting, cheaply.** Every repo page view (HTML, `.json`, `.md`, and badge hits) records a data point in **Workers Analytics Engine** (`repo_id`, `anon_id` hash, `logged_in`), which is unlimited-write and free-tier friendly, instead of a D1 write per view (100k/day cap). A 10-minute cron folds AE's `count(distinct anon_id)` per repo per day into `repo_views(repo_id, date, views, uniques)` in D1 (one write per active repo per run). If AE turns out not to be on the free plan, fall back to a sampled counter in the edge cache flushed hourly.
- **Logged-in votes vs visitors.** The existing ring check gains a third rule: in any rolling hour, if a repo's new votes exceed `max(10, 0.5 × uniques in that hour)`, votes beyond that are stored with weight 0 and the repo gets a `vote-burst` flag in the public log for a human to look at. Restored weights are one mod click. This catches a bot farm that never loads the page.
- **Anonymous votes: shown, never ranking.** An anonymous visitor gets a signed `anon` cookie (random id, HMAC, 1 year). They can press ▲/▼ once per repo; it lands in `anon_votes(repo_id, anon_hash, ip_hash, value, date)` and is displayed as a separate muted count ("+37 from the crowd"), **never** folded into `score`, `hot`, awards or `/best`. Cap per repo per UTC day = that day's `uniques` (a repo can't get more anonymous votes than it had anonymous visitors); per anon id 30/day; per IP hash 60/day. Fuzzed the same way. The row shows the crowd count next to the real score so it is transparent that they are different things.
- **Cheap fakes.** New anon cookies created in bulk from one IP hash count for nothing after the 5th that day; votes from clients that never fetched the page (no view data point for that anon id) are dropped silently. All thresholds are vars.
- **Why not count anonymous votes for real.** Every reference site tried and stopped: without an identity, a vote is worth exactly what a `curl` loop costs. Keeping them visible but separate gets the fun without the exploit, and a GitHub login is one click away.

## Later (borrowed from Product Hunt, deliberately deferred)

- **"Runs on my machine" confirmations** — a second, score-independent vote ("3 humans confirm it runs") next to the self-declared `status`. One extra `votes.kind` column.
- **Similar slop** — five listed repos sharing the most `repo_tags` values, on the repo page. One cached query.
- **Skipped on purpose:** collections, following, notifications, newsletter, digests (all need email or per-user write volume); upcoming pages, launch scheduling, hunters, star-rated reviews (contradict "just add the file" and the reddit-style brief); admin-featured tier (awards do it without editorial).

