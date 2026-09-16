-- The door needs a count of targeted hits per source, not just hits. One SQL tautology used to shut a
-- source for a day; now it takes BLOCK_AFTER of them (src/lib/tripwire.ts), and the count that decides
-- has to leave out the noise, or a crawler following three mangled links would be counted towards it.
ALTER TABLE tripwire_ips ADD COLUMN targeted INTEGER NOT NULL DEFAULT 0;
