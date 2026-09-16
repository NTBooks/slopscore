-- A takedown of a trawled listing used to delist it for good the moment it was asked for, by anyone, with
-- no login: three requests per address and twenty a day site-wide was the only brake, and there was no
-- undo. Now a request hides the listing at once (it leaves the site on the spot) and the deletion that
-- cannot be undone waits TAKEDOWN_GRACE (src/lib/virtual.ts), during which a moderator can put it back.
--
-- That needs a third outcome, and SQLite cannot widen a CHECK in place, so the table is rebuilt: same
-- columns plus `settle_at`, every row copied, the index recreated. The table is small and nothing else
-- references it by rowid.
CREATE TABLE takedowns_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER REFERENCES repos(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  user_id INTEGER,
  login TEXT,
  contact TEXT,
  message TEXT NOT NULL,
  ip_hash TEXT,
  -- hidden: off the site now, deleted for good at settle_at unless a moderator restores it.
  -- delisted: deleted for good (by the settle job, or a moderator's "remove now").
  -- queued: the day's automatic allowance was spent; nothing happened, a human decides.
  outcome TEXT NOT NULL CHECK (outcome IN ('hidden', 'delisted', 'queued')),
  settle_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_by TEXT,
  note TEXT
);
INSERT INTO takedowns_new (id, repo_id, full_name, user_id, login, contact, message, ip_hash, outcome, created_at, resolved_at, resolved_by, note)
  SELECT id, repo_id, full_name, user_id, login, contact, message, ip_hash, outcome, created_at, resolved_at, resolved_by, note FROM takedowns;
DROP TABLE takedowns;
ALTER TABLE takedowns_new RENAME TO takedowns;
CREATE INDEX takedowns_open ON takedowns(resolved_at, created_at DESC);
-- The settle job asks for what is due: open rows with a settle time.
CREATE INDEX takedowns_due ON takedowns(settle_at) WHERE resolved_at IS NULL AND settle_at IS NOT NULL;
