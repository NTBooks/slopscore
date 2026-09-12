# Moving to slopscupper.com

Written 2026-09-12, when the site was renamed to **SlopScupper** and started answering on a second domain.

## Where things stand right now

- **Both domains answer.** `slopscore.org` and `slopscupper.com` (plus their `www.` forms) route to the same
  worker.
- **`slopscore.org` is still primary.** `PRIMARY_HOST` in `wrangler.jsonc` is the switch. Everything absolute
  the site emits (canonical links, OpenGraph URLs, the sitemap, the RSS feeds, `llms.txt`, JSON-LD) uses the
  primary host, so the two domains never compete for the same page in search. `src/lib/host.ts` is the whole
  mechanism and `test/host.test.ts` pins the behaviour.
- **Login only happens on the primary host.** `/auth/*` on a secondary domain 302s to the primary one, because
  the GitHub OAuth app has a single registered callback and the state cookie has to be set on the host GitHub
  returns to. A visitor browsing `slopscupper.com` therefore looks logged out: session cookies belong to
  `slopscore.org`. That resolves itself when the primary flips.
- **Trawled listings are indexed** (`TRAWL_INDEX=on`, all environments), the same as opted-in ones: repo
  pages, owner pages, the sitemap and IndexNow. Turning it to anything else takes all four back out.
- **The name changed, the file did not.** The site is SlopScupper. The marker file is still `slopscore.md`,
  the version key is still `slopscore: 2`, and the score is still a slopscore. Do not change any of those:
  `slopscore.md` is the one search term nobody else owns, and every committed file in the wild names it.

## Before the first deploy of this commit

`slopscupper.com` must already be a zone in the Cloudflare account, or
`npx wrangler deploy --env production` **fails** on the custom-domain routes. Add the site in Cloudflare and
point the registrar's nameservers at it first.

If the domain is not ready and something needs deploying now, delete these two lines from the production
`routes` block and redeploy:

```jsonc
{ "pattern": "slopscupper.com", "custom_domain": true },
{ "pattern": "www.slopscupper.com", "custom_domain": true }
```

## The flip, in order

Nothing below is urgent. The site works indefinitely in its current state; this is only what it takes to make
`slopscupper.com` the real home.

1. **GitHub OAuth app** (github.com → Settings → Developer settings → OAuth Apps). Set the callback URL to
   `https://slopscupper.com/auth/callback` and the homepage URL to `https://slopscupper.com`. GitHub allows
   one callback per app, so this is a cutover, not an addition: do it immediately before step 4, and expect
   logins to fail in the gap. Device flow is unaffected. `scripts/secrets.bat` has the old URL in a comment.

2. **Stripe.** Add a webhook endpoint at `https://slopscupper.com/webhooks/stripe`, take the new signing
   secret, and `npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production`. Leave the old endpoint
   enabled for a few days; a signature from the retired endpoint will fail verification once the secret
   rotates, so drain it before deleting.

3. **Email Routing** on the new zone: Cloudflare → Email → Email Routing → custom addresses for `hello@` and
   `abuse@`, forwarding to the verified destination. Then update the `CONTACT_EMAIL`, `ABUSE_EMAIL` and
   `CONTACT_FROM` vars. The `MAIL` send-email binding sends from the zone, so `CONTACT_FROM` must live on a
   zone that has Email Routing enabled.

4. **`wrangler.jsonc`**: `PRIMARY_HOST` → `"slopscupper.com"`, `SITE_URL` → `"https://slopscupper.com"`.
   That one line moves every canonical, feed, sitemap and OpenGraph URL on the site.

5. **`src/lib/vocab.ts` — the one that can unlist people.** `SPEC_URL` and the host check on line ~10
   (`s === "slopscore.org/spec"`) decide whether a committed `slopscore.md` validates. **Accept both hosts**,
   do not swap one for the other: every file already in the wild says `spec: https://slopscore.org/spec`, and
   a strict swap rejects all of them on the next recrawl. New files can say either.

6. **Hardcoded fallbacks.** `grep -rn "slopscore\.org" src` and work through what is left. As of this commit:
   `src/jobs/critics.ts` and `src/lib/content.ts` (the OpenRouter `http-referer`), `src/lib/github.ts` (the
   crawler user agent), `src/lib/indexnow.ts`, `src/routes/contact.tsx` (address defaults and the
   `Message-ID` domain), `src/routes/agents.tsx` (`RULES_SNIPPET` and the skill's `ping` URL — these get
   pasted into other people's `CLAUDE.md` files, so they matter more than most), `src/views/repo.tsx` and
   `src/views/feed.tsx` (badge and spec links), `src/lib/slopmd.ts`, `scripts/seed.mjs`.

7. **The OpenGraph card.** `art/og.svg` prints `slopscore.org` on the last line. Change it, then rerender:

   ```bash
   node -e "const s=require('sharp'),f=require('fs');s(f.readFileSync('art/og.svg')).resize(1200,630).png({compressionLevel:9}).toFile('art/og.png').then(()=>f.copyFileSync('art/og.png','public/hero.png'))"
   ```

8. **Search Console.** See the section below; the order matters and one of the tools is the wrong one.

9. **Do not retire `slopscore.org`.** Links were emailed before the rename, listed repos carry
   `slopscore.org/badge/...` in their READMEs, and every `slopscore.md` in the wild names it in `spec:`. It
   costs nothing to keep answering. Once the flip has settled, a 301 from the old host is a change in
   `src/lib/host.ts` (return a redirect instead of rewriting the URL) — but `PRIMARY_HOST` already makes
   search prefer the new host without breaking anything, so there is no hurry.

## Google Search Console

There is an existing property for `slopscore.org`. Nothing about it needs to change today, and the tool that
looks like it was built for this job is the wrong one.

**Keep the old property. Do not delete it.** It holds every bit of historical performance data, and
`slopscore.org` stays the canonical host until `PRIMARY_HOST` flips. Deleting a property throws the history
away and gets none of it back.

**Do not use the Change of Address tool.** It is for a site move where the old host 301-redirects to the new
one, and it tells Google the old address is finished. Neither is true here: both hosts serve, on purpose,
because links to `slopscore.org` were emailed and listed repos carry its badge URL. Using it would ask Google
to drop a host that is still answering. If `slopscore.org` is ever actually retired behind a 301, that is when
Change of Address applies, and it needs both properties verified and the redirect already live.

What consolidates the two hosts instead is the canonical tag. Every page on `slopscupper.com` already points
its canonical at the primary host, so Google indexes one copy and attributes it to one domain. Flipping
`PRIMARY_HOST` flips every canonical at once, and Google follows it over the next few weeks.

### Now, before the flip

1. Add `slopscupper.com` as a **Domain property** (not URL-prefix: a domain property covers www, apex and both
   schemes in one). Verification is a DNS TXT record, and Cloudflare hosts the zone, so it is one record and
   about a minute to propagate.
2. **Do not submit a sitemap for it yet.** While `PRIMARY_HOST` is `slopscore.org`, every URL in
   `https://slopscupper.com/sitemap.xml` is a `slopscore.org` URL. Search Console rejects or ignores a sitemap
   whose URLs belong to a different property, and the errors are noise, not signal. The sitemap becomes
   submittable the moment step 4 of the flip lands.
3. Nothing else. The new property will show almost no data until the canonicals move, and that is correct.

### After the flip

1. Submit `https://slopscupper.com/sitemap.xml` to the new property. Its URLs are now `slopscupper.com` URLs.
2. Leave the `slopscore.org` sitemap submitted in the old property. It serves the same list, now pointing at
   the new host, which is exactly the signal that moves the index across.
3. Expect a dip. Impressions fall on the old property and climb on the new one over roughly two to six weeks,
   and the total usually sags in the middle of that. Nothing is broken; do not react to week one.
4. Watch **Page indexing** on the new property for "Alternate page with proper canonical tag" on
   `slopscore.org` URLs. That message means the setup is working as designed, not that something failed.

### While you are in there

With `TRAWL_INDEX=on` the sitemap carries every listing, trawled included, so it went from about a dozen URLs
to a couple of hundred. Two things follow:

- A good share of those will sit in **"Crawled — currently not indexed"** for a while. A trawled page's body is
  largely the repo's own README, and Google is slow to index text it can already find on github.com. This is
  worth watching rather than fixing in a hurry: the fix, if it is needed, is making sure the parts of the page
  that are *ours* (the Cap'm's reason for the pick, the scan report, the disclosure chips, votes and comments)
  carry enough weight above the README that the page is not a near-duplicate of the source.
- Use the old property's **Removals** tool if a takedown ever needs to be fast. A delisted trawled repo already
  404s and drops out on the next crawl, but Removals pulls it from results in hours instead of days. It is
  temporary (about six months) and buys time for the crawl to catch up; it is not a substitute for the delist.

## Bing, and everything else

Add the domain in Bing Webmaster Tools the same way, and submit the sitemap on the same schedule. IndexNow
needs nothing at all: the key is served by the worker at `/{key}.txt` on whichever host asks, so it works on
both domains the moment they answer.

## Verifying afterwards

```bash
curl -sI https://slopscupper.com/ | grep -i location          # nothing: it serves, it does not redirect
curl -s https://slopscupper.com/ | grep -o '<link rel="canonical"[^>]*>'
curl -sI https://slopscupper.com/auth/github | grep -i location  # -> the primary host
curl -s https://slopscupper.com/sitemap.xml | head -5
```

Then log in, vote once, and check `/log` shows it.
