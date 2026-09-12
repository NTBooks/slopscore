-- The tripwire: requests shaped like an attack, counted, and a 24-hour door on where they came from.
--
-- Three tables rather than a log of rows. A log is what an attacker wants: unbounded writes on a free-tier
-- database, driven by anyone who can hold down a key. These are counters keyed by (day, kind) and
-- (day, ip_hash), so a million probes cost the same handful of rows as ten do.
--
-- `severity` splits two very different things that both look like an attack in a log:
--   noise     the background radiation of the public internet -- .env probes, wp-admin, mangled ?page=
--             values from a crawler following a broken link. Counted so the mod console can show the
--             weather, never emailed on its own, never a reason to block anybody.
--   targeted  shapes that are nobody's accident: SQL tautologies, our own <repo> prompt delimiter arriving
--             in a query string, path traversal. These raise the email and close the door.
--
-- No raw IP is stored anywhere here. ip_hash is the same salted digest the vote ring-detector already uses
-- (ipHash in src/lib/trust.ts): HMAC'd with SESSION_SECRET, so the rows cannot be turned back into
-- addresses, and they stop meaning anything if the secret is rotated. They are deleted after a fortnight.
CREATE TABLE tripwire (
  day      TEXT NOT NULL,
  kind     TEXT NOT NULL,
  severity TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL,
  -- One redacted, truncated example, kept so a human can tell a real attempt from a bad link at a glance.
  sample   TEXT,
  PRIMARY KEY (day, kind)
);

-- Distinct sources per day: one host hammering is a different problem from a thousand hosts knocking once,
-- and that difference is the whole question when deciding whether to turn Bot Fight Mode on.
CREATE TABLE tripwire_ips (
  day     TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (day, ip_hash)
);

-- The door. Read once a minute per isolate into a small in-memory set, so the check on the hot path costs
-- nothing; a hash added here is also added to that set immediately, so the isolate that saw the probe
-- starts refusing at once.
CREATE TABLE tripwire_blocks (
  ip_hash TEXT PRIMARY KEY,
  until   INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  hits    INTEGER NOT NULL DEFAULT 1,
  at      INTEGER NOT NULL
);
CREATE INDEX tripwire_blocks_until ON tripwire_blocks(until);
