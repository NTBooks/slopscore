-- Every page of search results the trawl reads is checked against repos with `lower(full_name) IN (...)`,
-- which the UNIQUE index on full_name cannot serve: that is a full scan of repos per page, some thirty
-- pages a run and a run an hour. An expression index makes it the index lookup it was meant to be.
CREATE INDEX IF NOT EXISTS repos_lower_full_name ON repos(lower(full_name));
