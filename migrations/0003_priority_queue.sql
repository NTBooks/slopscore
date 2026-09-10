-- Paid queue jumpers: FIFO among themselves, processed before the free queue.
ALTER TABLE repos ADD COLUMN priority_at INTEGER;
CREATE INDEX repos_queue_order ON repos(status, priority_at, first_seen);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','x402')),
  repo_id INTEGER REFERENCES repos(id) ON DELETE SET NULL,
  user_id INTEGER,
  payer TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  external_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
