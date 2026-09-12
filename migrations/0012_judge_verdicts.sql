-- Keep the judge's verdict instead of throwing it away.
--
-- The trawl already pays a cheap model to look at every candidate (src/lib/judge.ts). Until now only the rejects
-- kept a trace of it, folded into trawl_skipped.reason as "judge: <code>", and the verdict on everything it let
-- through was discarded the moment the repo was inserted. That threw away the one thing the trawl is uniquely
-- able to measure: the trawl is a near-random sample of software whose author says in public that a model wrote
-- it, so what the judge saw across the whole sample -- listed and thrown back -- is the closest this site gets to
-- an answer to "what are people actually building with these things".
--
-- Both columns are advisory. `judge_code` never changes a listing after the fact (it is the same code that already
-- decided), and `judge_domain` never decided anything at all. Both are values from closed enums in judge.ts;
-- anything else is dropped before it reaches here, so no prose from a stranger or from the model is ever stored.
ALTER TABLE repos ADD COLUMN judge_code TEXT;
ALTER TABLE repos ADD COLUMN judge_domain TEXT;

-- The same two, for candidates the judge saw and the trawl did not list. This is the larger half of the sample,
-- and the more interesting one: it is everything out there that looked the part and wasn't.
ALTER TABLE trawl_skipped ADD COLUMN judge_code TEXT;
ALTER TABLE trawl_skipped ADD COLUMN judge_domain TEXT;
CREATE INDEX trawl_skipped_at ON trawl_skipped(at);
