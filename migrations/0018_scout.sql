-- The scout: tool names the trawl met and did not know, the candidates they add up to, and the tools a moderator approved.
--
-- tool_sightings is raw material: one row per (term, repo), written by the trawl as it goes and pruned after
-- 90 days. tool_candidates is what the nightly scout makes of it, one row per term, with a status a moderator
-- sets and the job never touches. tool_registry is the dictionary that grew: a tool here is searched for,
-- credited and counted from the next hour, and listed with its date on /method.

CREATE TABLE tool_sightings (
  term TEXT NOT NULL,                  -- normalised like a facet value: "kiro", "amazon-q"
  kind TEXT NOT NULL,                  -- 'topic' (built-with-x) | 'phrase' ("built with x" in a description or README)
  full_name TEXT NOT NULL,             -- lowercased owner/name of the repo that said it
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (term, full_name)
);
CREATE INDEX tool_sightings_at ON tool_sightings(at);

CREATE TABLE tool_candidates (
  term TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,        -- distinct repos that named it
  kinds TEXT NOT NULL DEFAULT '[]',    -- JSON: which kinds of evidence
  samples TEXT NOT NULL DEFAULT '[]',  -- JSON: up to three full_names, for a moderator to look at
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','merged','dismissed')),
  decided_by TEXT,
  decided_at INTEGER,
  decided_into TEXT                    -- the registry key it was approved as or merged into
);

CREATE TABLE tool_registry (
  key TEXT PRIMARY KEY,                -- the built_with value; a static key here EXTENDS the frozen tool
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',  -- JSON: words a claim may use, normalised
  claim_topics TEXT NOT NULL DEFAULT '[]', -- JSON: topics that are a claim, each also a search
  topics TEXT NOT NULL DEFAULT '[]',   -- JSON: topics that credit the tool
  phrases TEXT NOT NULL DEFAULT '[]',  -- JSON: '"built with kiro" in:description' searches
  note TEXT,
  approved_by TEXT NOT NULL,
  approved_at INTEGER NOT NULL DEFAULT (unixepoch()),
  retired_at INTEGER
);
