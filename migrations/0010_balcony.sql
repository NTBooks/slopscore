-- The Balcony (/balcony): the critics' votes, in public, the way the mod log puts moderation in public.
--
-- This reverses one line of 0009. There, a critic's reason was written down but never rendered, on the
-- grounds that the sentence is a model's reaction to a stranger's README. The vote itself was always
-- public (it moves a score), so the only thing kept back was the part that explains it — a leaderboard
-- that says "nothing here is a secret" should not keep the why in a drawer. The reason is published from
-- now on, through criticQuip() in src/lib/critics.ts: links, handles and markup stripped, profanity
-- dropped whole, one short escaped sentence. The vote is still yes/no, and critics still never comment.
--
-- Reviews written before this migration are published too: nothing in them was ever promised private to
-- an owner, and the same cleaner runs over every row on the way out.

-- 0009 indexes (critic_id, created_at) for the per-critic daily cap. The Balcony reads the other way
-- round: everybody's reviews, newest first, so it gets its own index.
CREATE INDEX critic_reviews_recent ON critic_reviews(created_at DESC);
