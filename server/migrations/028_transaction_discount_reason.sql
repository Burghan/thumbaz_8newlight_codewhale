-- Discount reason was collected in the old pos.html UI but silently discarded
-- server-side. Now that discounts require a real manager-PIN check, record why
-- it was granted alongside discount_pct/discount_amount (see migration 024).
ALTER TABLE transactions ADD COLUMN discount_reason TEXT;
