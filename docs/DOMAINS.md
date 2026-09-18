# Domains

Settled 2026-09-12, after the site was briefly renamed SlopScupper and moved back.

## The decision

**The site is SlopScore and it lives at slopscore.org.**

The reason is the marker file. `slopscore.md` is the one string in this project nobody else has taken — "slop
score" as a search term belongs to an unrelated benchmark, and there are half a dozen other projects using the
words — so the file is the asset, not the site name. Which means the site name should match the file:

> Add `slopscore.md`. It's from slopscore.org.

That sentence has no seam in it. It is the sentence that has to survive being repeated by an agent, pasted into
a README, and half-remembered a week later, and every extra name it carries is a place for it to break.

**slopscupper.com is a marketing address.** We own it, the worker answers on it, and it redirects here. The
Cap'm's ship is the **Sloptrawler**, which is where that family of words earns its keep: a boat that drags a
wide net is an accurate description of the trawl and a poor one for a masthead.

## How the redirect works

`PRIMARY_HOST` names home. Every other domain the worker answers on redirects to it with the path and query
intact, in one hop, `www.` dropped on the way (`src/lib/host.ts`, pinned by `test/host.test.ts`). Nothing else
in the codebase knows a hostname, so moving the site is one var.

It is a **302, not a 301**, on purpose. Browsers cache a 301 more or less forever and stop asking. If the two
domains ever swapped places, everyone who had already landed on slopscupper.com would hold a cached redirect
to slopscore.org while slopscore.org redirected back — a loop, in their browser, that we could not clear.
302 costs one request and shuts that door. Promote it to 301 (`SECONDARY_REDIRECT`) once the arrangement has
stopped moving.

Because everything redirects, the OAuth callback, the session cookie and the canonical URL only ever exist on
one hostname, which is what makes the arrangement boring.

## The test host is behind a password

test.slopscore.org is a full copy of the site with its own database, and a copy that answers 200 is a second
slopscore.org with the same titles and staler rows. robots.txt says `Disallow: /` there and every response carries
`x-robots-tag: noindex`, but a crawler that obeys the first never reads the second, and a URL it is forbidden to
read can still be listed if something links to it. So the host also asks for HTTP Basic Auth on every request
(`previewChallenge` in `src/lib/host.ts`, pinned by `test/app.test.ts`): a 401 is the one answer every engine
treats as "no page here". The password is the `PREVIEW_PASSWORD` secret on `--env test`; the username is ignored;
unset, the host answers 403 to everything, so a preview nobody gave a password to is shut, not open. Any
`*.workers.dev` hostname gets the same treatment. Let through without the password: `robots.txt`, the Stripe
webhook (Stripe cannot be handed a password), and any request that already carries a valid site session.

## Search Console: nothing to do

- **Keep the existing slopscore.org property.** It is home and it holds all the history.
- **Do not use the Change of Address tool.** Nothing moved.
- Adding slopscupper.com as a property is optional and only useful if you want to watch that the redirect is
  behaving. Do not submit a sitemap for it; it has no pages of its own.

What is worth watching on the real property: the sitemap carries **every repo listing** (`TRAWL_INDEX=on`) and
**only opted-in owners** (`TRAWL_OWNER_INDEX=off`), so it is currently ~173 repo URLs and one `/u/` URL. Expect
a share of the trawled pages to sit in "Crawled — currently not indexed" for a while: their bodies are largely
the repo's own README, and Google is slow to index text it can already find on github.com. If that persists,
the fix is making the parts of the page that are ours — the Cap'm's reason for the pick, the scan report, the
disclosure chips, votes and comments — carry more weight above the README.

## If this ever reverses

Keeping the list, because it is still the right order and the third item is the one that can hurt people:

1. **GitHub OAuth app** — one callback URL per app, so it is a cutover. Do it immediately before step 4 and
   expect logins to fail in the gap. Device flow is unaffected.
2. **Stripe** — new webhook endpoint, new signing secret via `wrangler secret put STRIPE_WEBHOOK_SECRET`.
   Leave the old endpoint enabled for a few days; drain it before deleting.
3. **`src/lib/vocab.ts`** — `SPEC_URL` and the host check on line ~10 decide whether a committed
   `slopscore.md` validates. **Accept both hosts.** Every file in the wild says
   `spec: https://slopscore.org/spec`, and swapping rather than adding rejects all of them on the next
   recrawl. That spec URL is a namespace identifier, not a homepage; it is fine for it to outlive any
   rebrand, and it should.
4. **`PRIMARY_HOST`** and `SITE_URL` in `wrangler.jsonc`. One line moves every canonical, feed, sitemap and
   OpenGraph URL.
5. **Email Routing** on the new zone, then `CONTACT_EMAIL`, `ABUSE_EMAIL`, `CONTACT_FROM`. The `MAIL` binding
   sends from the zone, so `CONTACT_FROM` must live somewhere Email Routing is enabled.
6. **Hardcoded fallbacks** — `grep -rn "slopscore\.org" src`. The ones that matter most are in
   `src/routes/agents.tsx`: `RULES_SNIPPET` and the skill's `ping` URL get pasted into other people's
   `CLAUDE.md` files.
7. **`art/og.svg`** prints the URL on its last line; rerender `public/hero.png` after changing it:
   ```bash
   node -e "const s=require('sharp'),f=require('fs');s(f.readFileSync('art/og.svg')).resize(1200,630).png({compressionLevel:9}).toFile('art/og.png').then(()=>f.copyFileSync('art/og.png','public/hero.png'))"
   ```
8. **Badges.** Listed repos carry `slopscore.org/badge/...` in their READMEs. Whatever happens, that host keeps
   answering.

## Checking it

```bash
curl -sI https://slopscupper.com/queue | grep -iE "^(HTTP|location)"   # 302 -> https://slopscore.org/queue
curl -s https://slopscore.org/ | grep -o '<link rel="canonical"[^>]*>'
```
