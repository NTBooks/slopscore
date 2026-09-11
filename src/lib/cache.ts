// Read-through cache for the hot D1 queries (feeds, rail, bucket counts, stats).
//
// Every cached entry is keyed by a data version that bumps whenever something a reader can see changes:
// a scan, a vote, a comment, a mod/owner action, an awards run. While nothing changes, the feed and the
// rail are served from the Workers Cache API (per data centre) with zero D1 row reads. The version
// itself is one row read per request, memoised for a few seconds per isolate.
//
// Falls back to running the query when the cache is unavailable (tests, local dev without a cache).

const VERSION_KEY = "data_version";
const NAMESPACE_KEY = "cache_namespace";
const VERSION_MEMO_MS = 5000;
const ORIGIN = "https://cache.slopscore.internal";

let memo: { v: string; at: number } | null = null;

/**
 * The data version, prefixed by a per-database random namespace.
 *
 * The Workers Cache API is shared by every Worker on the account in a data centre, so a key must never
 * collide across environments: without the namespace, production once served test's cached feed.
 * The namespace is minted once per database (INSERT OR IGNORE) and lives in crawl_state with the version.
 */
export async function dataVersion(db: D1Database): Promise<string> {
  if (memo && Date.now() - memo.at < VERSION_MEMO_MS) return memo.v;
  let rows = await readState(db);
  if (!rows.ns) {
    await db.prepare("INSERT OR IGNORE INTO crawl_state (key, value) VALUES (?, ?)").bind(NAMESPACE_KEY, crypto.randomUUID().slice(0, 12)).run();
    rows = await readState(db);
  }
  const v = `${rows.ns}/${rows.version}`;
  memo = { v, at: Date.now() };
  return v;
}

async function readState(db: D1Database): Promise<{ ns: string | null; version: string }> {
  const r = await db.prepare("SELECT key, value FROM crawl_state WHERE key IN (?, ?)").bind(VERSION_KEY, NAMESPACE_KEY).all<{ key: string; value: string }>();
  let ns: string | null = null;
  let version = "0";
  for (const row of r.results ?? []) {
    if (row.key === NAMESPACE_KEY) ns = row.value;
    if (row.key === VERSION_KEY) version = row.value;
  }
  return { ns, version };
}

/** Forget the memoised version (tests, which swap databases faster than the memo expires). */
export function resetVersionMemo(): void { memo = null; }

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
