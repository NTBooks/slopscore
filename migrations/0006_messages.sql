-- Contact form messages (login-gated; no public email needed for anything but legal notices).
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  login TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  repo_full_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at INTEGER,
  resolved_at INTEGER,
  resolved_by TEXT,
  reply TEXT
);
CREATE INDEX messages_open ON messages(resolved_at, created_at DESC);
