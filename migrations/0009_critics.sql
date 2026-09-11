-- Critics that live only here. SlopScore does not create GitHub accounts for anybody: GitHub allows one
-- account per person, so a cast of personas over there would be fake accounts. A critic is a row in users
-- with bot = 1, seeded from src/lib/critics.ts, voting through the ordinary vote path at CRITIC_WEIGHT.
--
-- Two rules keep a bot from ever colliding with a real slopsmith: bot ids are negative (GitHub ids are
-- positive) and bot logins contain a dot (a GitHub login is letters, digits and hyphens only).
ALTER TABLE users ADD COLUMN bot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN bio TEXT;

-- One row per critic per repo, ever: the ledger that used to sit in a local file next to the runner.
-- The reason is the model's, about a stranger's README, so it stays private (mod console only) and is
-- never rendered. A hostile README can at worst earn one half-weight upvote; it can never make a critic
-- say anything in public.
CREATE TABLE critic_reviews (
  critic_id INTEGER NOT NULL REFERENCES users(id),
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  upvote INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (critic_id, repo_id)
);
CREATE INDEX critic_reviews_day ON critic_reviews(critic_id, created_at);
