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
  url.hostname = primary;   // drops any www. in the same hop, so nobody is bounced twice
  return url.toString();
}
