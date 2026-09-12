// The Content-Security-Policy every HTML page carries.
//
// Repo pages render two pieces of third-party HTML verbatim: body_html (a slopscore.md rendered by GitHub's
// markdown API) and readme_html. GitHub's renderer sanitises both, and sanitizeReadmeHtml() in lib/markdown.ts
// passes them again to enforce the image allowlist and strip handlers. This header is the layer under those
// two: it assumes both have failed. Script runs only from this origin or with a hash we published, so markup
// smuggled into a README has nothing to execute.
//
// script-src is hash-based rather than nonce-based on purpose. Every inline script this site serves is a
// compile-time constant in views/clientjs.ts, so the hashes are computed from the same strings the pages
// emit and there is nothing to thread through the render. A new inline script that is not in INLINE_SCRIPTS
// simply does not run — which is the intended failure direction.
//
// Two deliberate loosenings:
//   style-src 'unsafe-inline'  the views use style="" attributes throughout, and CSP cannot hash an
//                              attribute. Inline style cannot execute script; the risk is cosmetic.
//   img-src <github hosts>     exactly the hosts imageAllowed() in lib/markdown.ts lets through, so the
//                              header and the sanitiser agree on one list.
import { INLINE_SCRIPTS } from "../views/clientjs";

/** The image hosts imageAllowed() admits. Keep in step with IMAGE_HOSTS in lib/markdown.ts. */
const IMG = ["'self'", "data:", "https://github.com", "https://*.githubusercontent.com", "https://img.shields.io", "https://opengraph.githubassets.com"];

/**
 * Cloudflare Web Analytics. The zone injects beacon.min.js into every HTML response before it leaves the
 * edge, so it arrives after this worker has run and there is nothing to hash -- the first policy blocked it
 * and silently took the site's analytics with it. The script comes from static.cloudflareinsights.com and
 * reports to cloudflareinsights.com/cdn-cgi/rum, so both are named, and neither is a wildcard.
 *
 * This is the only third-party script the policy admits. If Browser Insights is ever turned off for the
 * zone, both entries can go.
 */
const BEACON_SRC = "https://static.cloudflareinsights.com";
const BEACON_REPORT = "https://cloudflareinsights.com";

let cached: string | null = null;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  let b = "";
  for (const byte of new Uint8Array(d)) b += String.fromCharCode(byte);
  return `'sha256-${btoa(b)}'`;
}

/** Built once per isolate: the script bodies are module constants, so their hashes never change at runtime. */
export async function csp(): Promise<string> {
  if (cached) return cached;
  const hashes = (await Promise.all(INLINE_SCRIPTS.map(sha256))).join(" ");
  cached = [
    "default-src 'self'",
    `script-src 'self' ${BEACON_SRC} ${hashes}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${IMG.join(" ")}`,
    "font-src 'self'",
    `connect-src 'self' ${BEACON_REPORT}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return cached;
}
