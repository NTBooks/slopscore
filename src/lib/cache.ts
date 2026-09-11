// Read-through cache for the hot D1 queries (feeds, rail, bucket counts, stats).
//
// Every cached entry is keyed by a data version that bumps whenever something a reader can see changes:
// a scan, a vote, a comment, a mod/owner action, an awards run. While nothing changes, the feed and the
// rail are served from the Workers Cache API (per data centre) with zero D1 row reads. The version
// itself is one row read per request, memoised for a few seconds per isolate.
//
// Falls back to running the query when the cache is unavailable (tests, local dev without a cache).

const VERSION_KEY = "data_version";
const VERSION_MEMO_MS = 5000;
const ORIGIN = "https://cache.slopscore.internal";

let memo: { v: string; at: number } | null = null;

export async function dataVersion(db: D1Database): Promise<string> {
  if (memo && Date.now() - memo.at < VERSION_MEMO_MS) return memo.v;
  const r = await db.prepare("SELECT value FROM crawl_state WHERE key = ?").bind(VERSION_KEY).first<{ value: string }>();
  const v = r?.value ?? "0";
  memo = { v, at: Date.now() };
  return v;
}

/** Call after any write a reader could notice. Cheap: one upsert. */
export async function markDirty(db: D1Database): Promise<void> {
  await db.prepare(
    "INSERT INTO crawl_state (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
  ).bind(VERSION_KEY).run();
  memo = null;
}

function cacheApi(): Cache | null {
  try { return (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null; } catch { return null; }
}

/**
 * Run `fn` once per (key, data version) per data centre and serve the JSON result from cache afterwards.
 * `ttl` only bounds how long a stale version lingers; correctness comes from the version in the key.
 */
export async function cached<T>(db: D1Database, key: string, fn: () => Promise<T>, ttl = 6 * 3600): Promise<T> {
  const cache = cacheApi();
  if (!cache) return fn();
  const v = await dataVersion(db);
  const req = new Request(`${ORIGIN}/${v}/${encodeURIComponent(key)}`);
  try {
    const hit = await cache.match(req);
    if (hit) return (await hit.json()) as T;
  } catch { /* cache unavailable: fall through to the query */ }
  const val = await fn();
  try {
    await cache.put(req, new Response(JSON.stringify(val), { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }));
  } catch { /* best effort */ }
  return val;
}
