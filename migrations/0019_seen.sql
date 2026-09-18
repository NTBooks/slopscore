-- The sea: every repo the trawl's searches return, counted from the search response and nothing else.
--
-- The trough (repos, source = 'trawl') is what the site lists, and it is filtered before anything is read:
-- a star floor, a licence the site can quote from, a personal owner. Those are the right rules for a public
-- page and the wrong rules for a count, because they drop most of the labelled population before it is seen.
-- This table is the count. One row per repo the searches returned, at any star count, under any licence,
-- owned by anyone, with the facts GitHub's search response already carried and nothing more: no README is
-- read, no model is asked, no page is made, and no name here is ever shown on the site. Method v4.
--
-- Facts refresh on every sighting (stars, pushes, size); provenance keeps its first (ground, query, first_seen).
-- `sieve` is what the trough's own cheap rules said about the repo the day it was seen: 'candidate', or the
-- first rule that stopped it, in the trough's order. It is the rule in force that day, stored like a verdict.
CREATE TABLE trawl_seen (
  full_name TEXT PRIMARY KEY,          -- lowercased owner/name; the key, and the only text from the repo kept
  repo_id INTEGER NOT NULL,
  ground INTEGER NOT NULL,             -- index into TRAWL_GROUNDS at first sighting
  query TEXT NOT NULL,                 -- the bare search that first returned it
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  forks INTEGER NOT NULL,
  size_kb INTEGER NOT NULL,
  open_issues INTEGER NOT NULL,
  language TEXT,
  license TEXT,                        -- SPDX id as GitHub reports it; NULL when the repo carries none
  owner_type TEXT NOT NULL,            -- 'User' | 'Organization'
  created_at INTEGER NOT NULL,
  pushed_at INTEGER NOT NULL,
  described INTEGER NOT NULL,          -- 1 when the repo has a description (the text itself is not kept)
  topics_n INTEGER NOT NULL,
  homepage INTEGER NOT NULL,           -- 1 when the repo names a homepage
  tool TEXT,                           -- the tool its topics or description credit, by registry key, if any
  signal TEXT,                         -- the shape of the claim the search saw: vibe-coded | built-with | ai-generated | topic
  sieve TEXT NOT NULL                  -- 'candidate', or the trough rule that stopped it that day
);
CREATE INDEX trawl_seen_last ON trawl_seen(last_seen);
CREATE INDEX trawl_seen_first ON trawl_seen(first_seen);
