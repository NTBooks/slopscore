-- Trends: one aggregation pass a night, stored so the public dashboard costs one indexed query to draw.
--
-- Nothing here calls a model. Every number is a GROUP BY over rows the site already paid for: the facets a
-- scan wrote (repo_tags), what the trawl threw back (trawl_skipped), and which gate turned a submission away
-- (repos.scan). The snapshot exists because recomputing it per request would read the whole corpus per visitor.
--
-- One row per (snapshot day, cohort, metric, period, key). `period` is '' for a cross-section of the corpus as
-- it stands, or 'YYYY-MM' for a point in a monthly series. Snapshots are pruned after TRENDS_KEEP_DAYS.
CREATE TABLE trends_daily (
  date TEXT NOT NULL,                  -- UTC day the snapshot was taken
  cohort TEXT NOT NULL,                -- 'trawl' (we picked it) | 'opted' (they committed the file) | 'site'
  metric TEXT NOT NULL,                -- a facet name, or 'totals' | 'listings' | 'tool' | 'stars' | 'age' | 'net' | 'turned-away'
  period TEXT NOT NULL DEFAULT '',     -- '' = as it stands now; 'YYYY-MM' = a month in a series
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  mean_score REAL,
  PRIMARY KEY (date, cohort, metric, period, key)
);
