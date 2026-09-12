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

8. **Search engines.** Add `slopscupper.com` as a property in Google Search Console and Bing Webmaster Tools
   and submit `https://slopscupper.com/sitemap.xml`. IndexNow needs nothing: the key is served by the worker
   at `/{key}.txt` on whichever host asks.

9. **Do not retire `slopscore.org`.** Links were emailed before the rename, listed repos carry
   `slopscore.org/badge/...` in their READMEs, and every `slopscore.md` in the wild names it in `spec:`. It
   costs nothing to keep answering. Once the flip has settled, a 301 from the old host is a change in
   `src/lib/host.ts` (return a redirect instead of rewriting the URL) — but `PRIMARY_HOST` already makes
   search prefer the new host without breaking anything, so there is no hurry.

## Verifying afterwards

```bash
curl -sI https://slopscupper.com/ | grep -i location          # nothing: it serves, it does not redirect
curl -s https://slopscupper.com/ | grep -o '<link rel="canonical"[^>]*>'
curl -sI https://slopscupper.com/auth/github | grep -i location  # -> the primary host
curl -s https://slopscupper.com/sitemap.xml | head -5
```

Then log in, vote once, and check `/log` shows it.
