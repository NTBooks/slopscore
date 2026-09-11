-- Curated truffle backlog: repos an admin (or the admin's agent) vetted by hand, released into the scan queue a few a day.
-- The daily cron releases TRAWL_PER_DAY of these; the search-based trawl is manual only.
CREATE TABLE trawl_backlog (
  full_name TEXT PRIMARY KEY,            -- lowercased owner/name
  display_name TEXT NOT NULL,            -- as submitted
  reason TEXT NOT NULL,                  -- the public "why picked" (plain text, cites the owner's own claim)
  added_by TEXT,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  released_at INTEGER,
  outcome TEXT                           -- 'queued', or 'skipped: <why>' when the server-side checks refused it
);
CREATE INDEX trawl_backlog_open ON trawl_backlog(released_at, added_at);
