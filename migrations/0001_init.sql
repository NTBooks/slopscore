-- SlopScore schema. Timestamps are unix seconds (INTEGER).

CREATE TABLE users (
  id INTEGER PRIMARY KEY,              -- GitHub user id
  login TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  gh_created_at INTEGER,
  public_repos INTEGER DEFAULT 0,
  followers INTEGER DEFAULT 0,
  banned_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen INTEGER
);

CREATE TABLE repos (
  id INTEGER PRIMARY KEY,              -- GitHub repo id when known, else autoincrement
  full_name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id INTEGER,
  owner_type TEXT,                     -- User | Organization
  default_branch TEXT DEFAULT 'main',
  title TEXT,
  tagline TEXT,
  demo_url TEXT,
  stars INTEGER DEFAULT 0,
  forks INTEGER DEFAULT 0,
  language TEXT,
  license TEXT,
  pushed_at INTEGER,
  gh_created_at INTEGER,
  is_fork INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  gh TEXT,                             -- JSON snapshot of GitHub API data
  readme_html TEXT,
  readme_sha TEXT,
  images TEXT,                         -- JSON [{path, sha, size, checked}]
  images_hidden INTEGER DEFAULT 0,
  etag_repo TEXT,
  etag_readme TEXT,
  etag_contents TEXT,
  md_sha TEXT,
  md_updated_at INTEGER,
  meta TEXT,                           -- JSON parsed frontmatter
  body_md TEXT,
  body_html TEXT,
  tags_flat TEXT,                      -- 'facet:value' tokens, rebuilt with repo_tags; feeds FTS
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','quarantined','rejected','listed','hidden','delisted')),
  tier TEXT NOT NULL DEFAULT 'found' CHECK (tier IN ('found','submitted')),
  submitted_by INTEGER,
  submitted_at INTEGER,
  removed_at INTEGER,
  removed_reason TEXT,
  queue_reason TEXT,
  risk INTEGER DEFAULT 0,
  reject_reason TEXT,
  scan TEXT,                           -- JSON gate results
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  hot REAL NOT NULL DEFAULT 0,
  controversy REAL NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  listed_at INTEGER,
  last_crawled INTEGER,
  next_crawl INTEGER
);
CREATE INDEX repos_status_hot ON repos(status, hot DESC);
CREATE INDEX repos_status_listed ON repos(status, listed_at DESC);
CREATE INDEX repos_status_score ON repos(status, score DESC);
CREATE INDEX repos_status_updated ON repos(status, md_updated_at DESC);
CREATE INDEX repos_status_first_seen ON repos(status, first_seen DESC);
CREATE INDEX repos_next_crawl ON repos(next_crawl);
CREATE INDEX repos_owner ON repos(owner);

CREATE TABLE repo_tags (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  facet TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'declared' CHECK (source IN ('declared','detected','alias')),
  recognized INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (repo_id, facet, value)
);
CREATE INDEX repo_tags_facet_value ON repo_tags(facet, value);

CREATE TABLE repo_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  md_sha TEXT,
  meta TEXT,
  body_md TEXT,
  stars INTEGER,
  seen_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX repo_versions_repo ON repo_versions(repo_id, seen_at DESC);

CREATE TABLE votes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, repo_id)
);
CREATE INDEX votes_repo ON votes(repo_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES comments(id),
  body_md TEXT NOT NULL,
  body_html TEXT NOT NULL,
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  hidden_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX comments_repo ON comments(repo_id, created_at);

CREATE TABLE comment_votes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, comment_id)
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('repo','comment')),
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_by TEXT,
  resolution TEXT,
  UNIQUE (target_type, target_id, user_id)
);
CREATE INDEX reports_open ON reports(resolved_at, created_at);

CREATE TABLE mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_login TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'admin' CHECK (actor_role IN ('admin','owner','system')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_label TEXT,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX mod_log_created ON mod_log(created_at DESC);

CREATE TABLE denylist (
  term TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('slur','spam','domain')),
  scope TEXT NOT NULL DEFAULT 'any' CHECK (scope IN ('title','any')),
  added_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('day','week','upcoming-week')),
  period TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (kind, period, rank)
);
CREATE INDEX awards_repo ON awards(repo_id);

CREATE TABLE stats_daily (
  date TEXT PRIMARY KEY,
  neurons_used INTEGER DEFAULT 0,
  neurons_budget INTEGER DEFAULT 0,
  scans INTEGER DEFAULT 0,
  deferred INTEGER DEFAULT 0,
  found INTEGER DEFAULT 0,
  listed INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  quarantined INTEGER DEFAULT 0,
  reports INTEGER DEFAULT 0
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE crawl_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Full-text search over listed repos. External-content table kept in sync by triggers.
CREATE VIRTUAL TABLE repos_fts USING fts5(
  title, tagline, body, tags_flat, owner, name,
  content='repos', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER repos_ai AFTER INSERT ON repos BEGIN
  INSERT INTO repos_fts(rowid, title, tagline, body, tags_flat, owner, name)
  VALUES (new.id, new.title, new.tagline, new.body_md, new.tags_flat, new.owner, new.name);
END;
CREATE TRIGGER repos_ad AFTER DELETE ON repos BEGIN
  INSERT INTO repos_fts(repos_fts, rowid, title, tagline, body, tags_flat, owner, name)
  VALUES ('delete', old.id, old.title, old.tagline, old.body_md, old.tags_flat, old.owner, old.name);
END;
CREATE TRIGGER repos_au AFTER UPDATE OF title, tagline, body_md, tags_flat, owner, name ON repos BEGIN
  INSERT INTO repos_fts(repos_fts, rowid, title, tagline, body, tags_flat, owner, name)
  VALUES ('delete', old.id, old.title, old.tagline, old.body_md, old.tags_flat, old.owner, old.name);
  INSERT INTO repos_fts(rowid, title, tagline, body, tags_flat, owner, name)
  VALUES (new.id, new.title, new.tagline, new.body_md, new.tags_flat, new.owner, new.name);
END;
