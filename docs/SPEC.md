# slopscore.md — the contract (v2)

Principle: the file only holds what GitHub can't tell us. Name, description, topics, language, license, stars, README, and release come from the API.

Missing or invalid **disclosure** fields reject the repo with the reason shown publicly on its page. Fix the file, then `curl /ping/owner/repo` (or press Refresh if you own it).

## Minimal file

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
slopbucket: [cli]            # optional: pick a bucket or invent one
---
```

## Required (disclosures)

- slopscore: 2 (spec version)
- spec: https://slopscore.org/spec — the URL of this contract. It credits where the format comes from, and it is how a crawler knows the file is meant for SlopScore rather than a lookalike.
- Older files: a v1 file on a repo that is already listed stays listed and votable, with an "outdated paperwork" note on its page until it is updated. New listings need the current version.
- ai_generated: entirely | mostly | partly | none
- human_touch: none | light | heavy
- content_rating: everyone (mature | adult are rejected)
- contains: list, may be empty. Listed with a chip: crypto, financial, medical, legal, scraping, security-research, weapons-fiction, gambling-sim, mild-language. Rejected: nudity, sexual, gore, hate, harassment, drugs, real-weapons, malware, spam.
- category: ≥ 1 of devtools, cli, web-app, mobile, game, library, api, bot, agent, mcp-server, data, ml, automation, iot, media, productivity, security, finance, education, science, art, social, infra, plugin, extension, template, dataset, docs, toy, other
- status: idea | prototype | works-on-my-machine | alpha | beta | stable | maintained | abandoned
- tagline: ≤ 140 chars, or a GitHub description (rejected only if both are empty)

## Optional facets (unknown values never reject; they're kept as free tags marked unrecognized)

- title, tagline, demo_url — override GitHub
- built_with: claude-code, claude, cursor, copilot, codex, gemini-cli, windsurf, aider, cline, chatgpt, lovable, bolt, v0, replit, other
- models: free
- interface: cli, tui, web, desktop, mobile, api, library, bot, mcp, plugin, headless
- frameworks: free (aliases normalized: next.js→nextjs)
- platforms: linux, macos, windows, android, ios, web, docker, cloudflare, aws, gcp, azure, raspberry-pi, browser
- audience: developers, end-users, researchers, kids, enterprises, agents, me
- data: none, local-only, sends-telemetry, needs-api-key, stores-pii, scrapes
- needs: free (external accounts/keys)
- domain: free (subject matter)
- tags: free, ≤ 20; GitHub topics are merged in as detected
- slopbucket: up to 3 buckets (subreddit-style feeds at /b); unknown ones are created, banned ones stripped
- images: explicit repo-relative image paths (else slopscore-1.png … slopscore-6.png at the root are auto-discovered)
- maintainers: GitHub logins who get owner controls on the site (the only way for an org-owned repo)
- unlisted: true — delist on next check without logging in
- x-anything: preserved verbatim, never validated

## Body

Optional markdown after the frontmatter, ≤ 4000 chars: the pitch. If empty, the README is the pitch.

## Aliases

- cc → claude-code
- claude code → claude-code
- claudecode → claude-code
- github-copilot → copilot
- github copilot → copilot
- openai-codex → codex
- gemini cli → gemini-cli
- gemini → gemini-cli
- gpt → chatgpt
- gpt-4 → chatgpt
- gpt4 → chatgpt
- k8s → kubernetes
- js → javascript
- ts → typescript
- py → python
- rb → ruby
- rs → rust
- golang → go
- c++ → cpp
- c# → csharp
- node → nodejs
- node.js → nodejs
- next → nextjs
- next.js → nextjs
- vue.js → vue
- react.js → react
- svelte-kit → sveltekit
- mac → macos
- osx → macos
- win → windows
- rpi → raspberry-pi
- raspberrypi → raspberry-pi
- cf → cloudflare
- workers → cloudflare
- cloudflare-workers → cloudflare
- devs → developers
- developer → developers
- users → end-users
- end users → end-users
- myself → me
- wip → prototype
- works → works-on-my-machine
- fully → entirely
- all → entirely
- 100% → entirely
- some → partly
- partially → partly
- heavily → heavy
- lightly → light
- minimal → light
- web-ui → web
- website → web
- webapp → web-app
- command-line → cli
- terminal → cli
- everybody → everyone
- general → everyone
- g → everyone

## Search operators

category: cat: lang: language: tool: built_with: model: platform: interface: ui: audience: data: human: ai: status: contains: framework: needs: domain: tag: bucket: slopbucket: topic: license: owner: user: tier:
 — prefix with `-` to exclude. Quotes for phrases.

Machine-readable: `/api/v1/vocab`.