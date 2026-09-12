// Two domains, one site. slopscupper.com is the name; slopscore.org is where the links people already have
// point and where the GitHub OAuth app is registered. PRIMARY_HOST decides which hostname every absolute URL
// we emit uses — canonical, OpenGraph, the sitemap, llms.txt, the RSS feeds — so the two hosts never compete
// for the same page in search. Flipping that one var moves the whole site; nothing else knows a hostname.

/** Hosts that are always themselves: dev, preview deploys, and the test environment's own domain. */
function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".workers.dev") || hostname.startsWith("test.");
}

export function primaryHost(env: { PRIMARY_HOST?: string }): string {
  return (env.PRIMARY_HOST ?? "").trim().toLowerCase();
}

/** True when this request arrived somewhere other than the primary host and should be spoken about as if it hadn't. */
export function isSecondaryHost(hostname: string, primary: string): boolean {
  return Boolean(primary) && !isLocal(hostname) && hostname.replace(/^www\./, "") !== primary;
}

/**
 * Serve a request that arrived on a secondary domain as if it had arrived on the primary one: only the URL the
 * code reads changes, the browser stays where it is. `/auth` is left alone — GitHub's OAuth app has a single
 * callback URL, and the state cookie has to be set on the host GitHub will return to, so login redirects to the
 * primary host instead (src/index.ts).
 */
export function onPrimaryHost(request: Request, env: { PRIMARY_HOST?: string }): Request {
  const primary = primaryHost(env);
  const url = new URL(request.url);
  if (!isSecondaryHost(url.hostname, primary)) return request;
  if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return request;
  url.hostname = url.hostname.startsWith("www.") ? `www.${primary}` : primary;
  return new Request(url.toString(), request);
}
