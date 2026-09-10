-- Phase 4: views (for vote/visitor correlation), anonymous crowd votes, comment moderation, admin locks.

-- Page views per repo per UTC hour. One UPDATE per (sampled) view; folded into daily numbers on read.
CREATE TABLE repo_views (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  hour INTEGER NOT NULL,                -- unix seconds / 3600
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, hour)
);
CREATE INDEX repo_views_hour ON repo_views(hour);

-- Anonymous votes: shown as a separate "crowd" count, never folded into score/hot/awards.
CREATE TABLE anon_votes (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  anon_hash TEXT NOT NULL,
  ip_hash TEXT,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (repo_id, anon_hash)
);
CREATE INDEX anon_votes_day ON anon_votes(day, ip_hash);
ALTER TABLE repos ADD COLUMN crowd_up INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repos ADD COLUMN crowd_down INTEGER NOT NULL DEFAULT 0;

-- Comment moderation: why a comment is held, and who held it.
ALTER TABLE comments ADD COLUMN held_reason TEXT;
ALTER TABLE comments ADD COLUMN guard TEXT;       -- JSON: Llama Guard result for the comment

-- Admin locks: a repo delisted/hidden by an admin stays that way until an admin restores it.
ALTER TABLE repos ADD COLUMN locked_by TEXT;
ALTER TABLE repos ADD COLUMN mod_note TEXT;

-- Bans carry a reason.
ALTER TABLE users ADD COLUMN ban_reason TEXT;
