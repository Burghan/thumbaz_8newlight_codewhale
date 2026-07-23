-- Some rewards represent real rupiah value against the current bill (e.g.
-- Menu Credit) rather than a physical handover (Merchandise, Alat Kopi,
-- Rokpresso) — this column marks how much, so redeeming one during Payment
-- can actually reduce what's owed instead of just being a logged handover.
ALTER TABLE loyalty_rewards ADD COLUMN discount_value INTEGER;

UPDATE loyalty_rewards SET discount_value = 15000 WHERE name = 'Menu Credit (Rp 15.000)';
