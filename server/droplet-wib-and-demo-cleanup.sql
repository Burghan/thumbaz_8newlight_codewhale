-- ============================================================
-- Droplet maintenance: WIB timezone backfill + demo-data cleanup
-- Mirrors fixes already applied to the local dev database on 2026-07-22.
-- Run manually via: sqlite3 data/backoffice.db
--   (or: sqlite3 data/backoffice.db < server/droplet-wib-and-demo-cleanup.sql
--    but read through it first — the DELETE at the bottom needs a value
--    filled in from its own CHECK query, it will not do anything useful
--    piped in blindly)
--
-- ALWAYS back up first:
--   sqlite3 data/backoffice.db "PRAGMA wal_checkpoint(FULL);"
--   cp data/backoffice.db data/backoffice.db.backup.$(date +%Y%m%d%H%M%S)
--
-- Run each CHECK query, look at what it returns, THEN run the matching
-- UPDATE/DELETE. Do not run the UPDATEs twice — they are not idempotent
-- (a second run would shift times by another 7 hours and re-break them).
-- ============================================================


-- ------------------------------------------------------------
-- 1. stock_movements.created_at — this column's own DEFAULT was bare
--    datetime('now'), i.e. UTC, while purchases.purchased_at and
--    everything else correctly use datetime('now','+7 hours') (WIB).
--    No insert path ever set created_at explicitly before the code fix,
--    so every existing row has the same 7-hour-behind bug, with no
--    exceptions — a uniform +7 hours is safe.
-- ------------------------------------------------------------

-- CHECK — pick any purchase and compare its WIB purchased_at against its
-- linked stock_movements.created_at. If you see the same purchase with
-- two times ~7 hours apart, the backfill below is needed.
SELECT sm.id, sm.type, sm.created_at AS movement_time, p.purchased_at AS purchase_time
FROM stock_movements sm
JOIN purchases p ON p.id = sm.ref_id AND sm.ref_type = 'purchase'
ORDER BY sm.id DESC LIMIT 10;

-- CHECK — how many rows would this touch?
SELECT COUNT(*) AS stock_movements_total FROM stock_movements;

-- UPDATE — run once only.
UPDATE stock_movements SET created_at = datetime(created_at, '+7 hours');


-- ------------------------------------------------------------
-- 2. kitchen_tickets.created_at / updated_at — identical bug, same fix.
-- ------------------------------------------------------------

-- CHECK
SELECT COUNT(*) AS kitchen_tickets_total FROM kitchen_tickets;
SELECT id, status, created_at, updated_at FROM kitchen_tickets ORDER BY id DESC LIMIT 10;

-- UPDATE — run once only.
UPDATE kitchen_tickets
SET created_at = datetime(created_at, '+7 hours'),
    updated_at = datetime(updated_at, '+7 hours');


-- ------------------------------------------------------------
-- 3. Demo/seed attendance data — bulk-inserted test rows with fake
--    future clock_in/clock_out dates. Found locally: 260 rows sharing
--    one of three identical bulk-insert created_at timestamps (real
--    clock-ins each get their own unique created_at down to the
--    second, so any created_at shared by many rows is almost certainly
--    a seed script, not real usage).
-- ------------------------------------------------------------

-- CHECK — created_at values shared by more than a handful of rows.
-- If this returns nothing, the droplet was never seeded and you can
-- skip this section entirely.
SELECT created_at, COUNT(*) AS row_count
FROM attendances
GROUP BY created_at
HAVING COUNT(*) > 5
ORDER BY row_count DESC;

-- CHECK — preview exactly which rows those are before deleting anything.
-- Look at clock_in/clock_out here: seed data has suspiciously round
-- shift times (e.g. 08:00:00/16:00:00) on dates that don't correspond
-- to when anyone actually clocked in.
SELECT id, employee_name, clock_in, clock_out, created_at
FROM attendances
WHERE created_at IN (
  SELECT created_at FROM attendances GROUP BY created_at HAVING COUNT(*) > 5
)
ORDER BY id;

-- DELETE — only after the preview above confirms it's really seed data.
-- Replace the list below with the exact created_at values you confirmed
-- (this is deliberately not auto-filled from the query above, so you
-- can't delete something you haven't looked at first).
--
-- RUN ON THE DROPLET 2026-07-24 — confirmed via server/inspect-attendance-
-- duplicates.js (added that day; read-only report, safe to re-run any time
-- to re-check for this pattern). These three values were seed-demo.js/
-- seed_full_demo.js bulk inserts (June + two duplicate July batches, the
-- second adding Natasya) — 260 rows total, all round 08:00/16:00 (or 14:00
-- Saturdays) with no photo. Removed 269 -> 9 rows; the 9 remaining were
-- verified real (unique timestamps, mostly with photos) before and after.
DELETE FROM attendances
WHERE created_at IN (
  '2026-07-10 14:01:35',
  '2026-07-10 14:01:25',
  '2026-07-10 13:12:33'
);
