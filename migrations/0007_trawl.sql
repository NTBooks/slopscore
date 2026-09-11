-- Truffle trawling expedition: repos that never opted in, listed with paperwork the Cap'm wrote (src/lib/virtual.ts),
-- takedown requests that need no login, and disclosed critic votes.

-- 'marker' = the repo committed slopscore.md (opted in). 'trawl' = found by the trawl; virtual_md stands in for the file.
-- The values sort so opted-in repos come first under a plain ASC.
ALTER TABLE repos ADD COLUMN source TEXT NOT NULL DEFAULT 'marker' CHECK (source IN ('marker', 'trawl'));
ALTER TABLE repos ADD COLUMN virtual_md TEXT;
ALTER TABLE repos ADD COLUMN virtual_reason TEXT;
-- Upvotes from disclosed critics (CRITIC_LOGINS). Shown beside the score; subtracted when awards are ranked.
ALTER TABLE repos ADD COLUMN critic_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE votes ADD COLUMN critic INTEGER NOT NULL DEFAULT 0;

-- Feeds sort opted-in first; these keep the common sorts index-driven.
CREATE INDEX repos_feed_hot ON repos(status, source, hot DESC);
CREATE INDEX repos_feed_top ON repos(status, source, score DESC);
CREATE INDEX repos_feed_new ON repos(status, source, listed_at DESC);

-- Candidates the trawl rejected (denylist, failed a gate, no README). Never re-evaluated. full_name is lowercased.
CREATE TABLE trawl_skipped (
  full_name TEXT PRIMARY KEY,
  reason TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Takedown requests for trawled listings. No login required; the message is private (mod console only).
CREATE TABLE takedowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER REFERENCES repos(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  user_id INTEGER,
  login TEXT,
  contact TEXT,
  message TEXT NOT NULL,
  ip_hash TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('delisted', 'queued')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_by TEXT,
  note TEXT
);
CREATE INDEX takedowns_open ON takedowns(resolved_at, created_at DESC);
