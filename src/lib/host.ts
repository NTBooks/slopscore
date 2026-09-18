// Two domains, one home. The site is SlopScore and it lives at slopscore.org: the name matches the address,
// which is what makes "add slopscore.md, it's from slopscore.org" a sentence somebody can act on without a seam
// in it. slopscupper.com is a marketing address we own — it answers, and it sends you here.
//
// PRIMARY_HOST is the home. Any other domain this worker answers on redirects to it, path and query intact;
// nothing else in the codebase knows a hostname, so moving the site is one var.

/** A copy of the site that must never be indexed: a preview deploy or the test environment. Local dev is
 *  neither -- nothing can crawl it -- so it keeps production's robots.txt, which is what it is there to check. */
export function isPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".workers.dev") || hostname.startsWith("test.");
}

/**
 * The door on a copy of the site.
 *
 * robots.txt and a noindex header ask crawlers to stay out of the test host; a password makes them. A copy
 * that answers 200 is a second slopscore.org with the same titles and staler rows, and a crawler that finds
 * a link to it (the README carries one) can list the URL without reading the page, since robots.txt forbids
 * the read that would show it the noindex. A 401 is a page that does not exist as far as an index is
 * concerned, and it is the one answer every engine treats that way.
 *
 * PREVIEW_PASSWORD is a secret on the test environment; the username is not checked. Unset, the copy is
 * shut outright rather than open: a preview deploy nobody remembered to give a password to is exactly the
 * copy that must not leak. Home and local dev never see this.
 *
 * Through the door without the password: a request that already carries a valid site session (the caller
 * of previewChallenge says so: an agent with a device-flow token is not a crawler), the Stripe webhook (Stripe
 * signs its own requests and cannot be handed a password), and robots.txt, which keeps telling crawlers no.
 * Static assets are served by the platform before the worker runs and stay open; a stylesheet has no
 * search result to compete with.
 */
export function previewChallenge(request: Request, env: { PREVIEW_PASSWORD?: string }, opts: { signedIn?: boolean } = {}): Response | null {
  const url = new URL(request.url);
  if (!isPreviewHost(url.hostname)) return null;
  if (opts.signedIn) return null;
  if (url.pathname === "/robots.txt" || url.pathname === "/webhooks/stripe") return null;
  const headers: Record<string, string> = { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" };
  const want = (env.PREVIEW_PASSWORD ?? "").trim();
  if (!want) return new Response("This copy of the site is shut: it has no PREVIEW_PASSWORD. The site is at https://slopscore.org.\n", { status: 403, headers });
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("basic ")) {
    let given = "";
    try { given = atob(auth.slice(6).trim()); } catch { /* not base64: not the password */ }
    if (sameString(given.slice(given.indexOf(":") + 1), want)) return null;
  }
  headers["www-authenticate"] = 'Basic realm="SlopScore test copy", charset="UTF-8"';
  return new Response("A copy of the site, not the site. The one to read is https://slopscore.org.\n", { status: 401, headers });
}

/** Equal without a length or content short-circuit, so a wrong password costs the same as a nearly right one. */
function sameString(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Hosts that are always themselves: dev, preview deploys, and the test environment's own domain. */
function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || isPreviewHost(hostname);
}

/**
 * The origin every absolute URL handed to a third party is built on: the sitemap, the robots Sitemap line,
 * IndexNow. SITE_URL when it is set, else the request's own origin. Built from the request alone, a sitemap
 * fetched from the test host would be a sitemap full of test URLs.
 */
export function siteOrigin(request: Request, env: { SITE_URL?: string }): string {
  const site = (env.SITE_URL ?? "").trim();
  if (site) { try { return new URL(site).origin; } catch { /* a bad var falls through to the request */ } }
  return new URL(request.url).origin;
}

/**
 * Found, not moved permanently.
 *
 * A 301 is what a marketing domain deserves and it is not what this one gets yet. Browsers cache a 301 for a
 * very long time and will not re-ask, so if the two domains ever swap places, everyone who once landed on
 * slopscupper.com has a cached redirect pointing at slopscore.org while slopscore.org is redirecting back:
 * a loop, in their browser, that we cannot clear. 302 costs a request and keeps that door shut. Make it 301
 * when the arrangement has stopped moving.
 */
export const SECONDARY_REDIRECT = 302;

export function primaryHost(env: { PRIMARY_HOST?: string }): string {
  return (env.PRIMARY_HOST ?? "").trim().toLowerCase();
}

/** True when this request arrived on a domain that is not home. `www.` is ignored: that has its own redirect. */
export function isSecondaryHost(hostname: string, primary: string): boolean {
  return Boolean(primary) && !isLocal(hostname) && hostname.replace(/^www\./, "") !== primary;
}

/** Where a request that arrived on a secondary domain should be sent, or null when it is already home. */
export function homeUrl(request: Request, env: { PRIMARY_HOST?: string }): string | null {
  const primary = primaryHost(env);
  const url = new URL(request.url);
  if (!isSecondaryHost(url.hostname, primary)) return null;
  const moved = MOVED_HOMES[url.hostname.replace(/^www\./, "")];
  if (moved && (url.pathname === "/" || url.pathname === "")) url.pathname = moved;   // the old front door lands on the page that moved here
  url.hostname = primary;   // drops any www. in the same hop, so nobody is bounced twice
  return url.toString();
}

/**
 * Hostnames that used to be a whole site of their own and are now one page here. Their front door goes to
 * that page; any deeper path is sent home as-is, the same as any other secondary domain. The AI Nutrition
 * Label lived at slopscore.lumpdepot.com before it moved in next to slopscore.md (see /schemas).
 */
const MOVED_HOMES: Record<string, string> = {
  "slopscore.lumpdepot.com": "/label/fiction/",
};
