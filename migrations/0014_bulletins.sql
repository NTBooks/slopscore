-- The Trawl Report: a weekly bulletin, written once and never rewritten.
--
-- Everything in a report could in principle be recomputed from trends_daily, and for about six months it can be
-- (TRENDS_KEEP_DAYS prunes snapshots after 180 days). That is exactly why the report is stored rather than
-- derived: a number somebody quoted in March has to still say in March's words what it said in March, after the
-- snapshot it came from has been pruned and after the method that produced it has moved on a version. So the
-- rendered markdown is frozen at write time, the numbers behind it are frozen beside it as JSON, and the method
-- version in force that night is frozen with both. A report is a citation, not a view.
--
-- One row per ISO week. The slug is the week, so writing the same week twice replaces nothing and inserts
-- nothing: the job is idempotent and a manual re-run is safe.
--
-- Named `bulletins` rather than `reports` because `reports` is already taken, by the other kind: a reader
-- reporting a listing to the moderators (0001_init.sql). Two unrelated things called the same word in the
-- same database is a bug waiting for whoever writes the next join.
CREATE TABLE bulletins (
  slug TEXT PRIMARY KEY,               -- ISO week, 'YYYY-Www' — the week the report covers, not the day it ran
  at INTEGER NOT NULL,                 -- when it was written
  covers_from TEXT,                    -- snapshot date it compared against; NULL on the first report
  covers_to TEXT NOT NULL,             -- snapshot date it was written from
  method INTEGER NOT NULL,             -- lib/method.ts METHOD_VERSION in force that night
  title TEXT NOT NULL,
  body TEXT NOT NULL,                  -- the published markdown, frozen
  data TEXT NOT NULL                   -- the numbers it was written from, frozen (JSON)
);
CREATE INDEX bulletins_at ON bulletins(at DESC);
