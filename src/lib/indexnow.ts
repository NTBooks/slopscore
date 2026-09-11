// IndexNow: push new and changed URLs to Bing, Yandex, Seznam and Naver the moment they change,
// instead of waiting for a crawl. One key, shared by every participating engine, published at
// https://slopscore.org/{key}.txt so the engines can prove we own the host.
// Google has no equivalent — it retired the sitemap ping in 2023 and finds us through
// robots.txt, the sitemap, and Search Console.
import type { Env } from "../env";

const ENDPOINT = "https://api.indexnow.org/indexnow";

/** The configured key, or null when unset or malformed (the spec allows 8-128 of [a-zA-Z0-9-]). */
export function indexNowKey(env: Env): string | null {
  const k = (env.INDEXNOW_KEY ?? "").trim();
  return /^[A-Za-z0-9-]{8,128}$/.test(k) ? k : null;
}

/** Absolute site origin, or null on localhost — the engines will not accept a host they cannot fetch. */
function publicOrigin(env: Env): string | null {
  try {
    const u = new URL(env.SITE_URL ?? "");
    return /^(localhost|127\.|\[?::1)/.test(u.hostname) ? null : u.origin;
  } catch { return null; }
}

/** Tell the engines about site-relative paths (e.g. "/r/owner/name"). Never throws, never blocks a response for long. */
export async function pingIndexNow(env: Env, paths: string[]): Promise<boolean> {
  const key = indexNowKey(env);
  const origin = publicOrigin(env);
  if (!key || !origin || !paths.length) return false;
  const urlList = [...new Set(paths)].slice(0, 100).map((p) => `${origin}${p}`);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
      signal: AbortSignal.timeout(5000),
    });
    // 200 accepted, 202 accepted but the key is still being verified. Anything else is ours to log and forget.
    if (r.status !== 200 && r.status !== 202) console.log("indexnow", r.status, urlList.length);
    return r.status === 200 || r.status === 202;
  } catch (e) {
    console.log("indexnow failed", (e as Error).message);
    return false;
  }
}
