-- 025: track the originating riwayat receipt number on a void. Lets the
-- riwayat importer recognize, on a later re-import of overlapping dates,
-- that a fully cancelled receipt was already recorded-then-voided, instead
-- of recreating and re-voiding it every time the same file is re-imported.
ALTER TABLE void_log ADD COLUMN reference TEXT;
