-- Whole-order discount applied at Payment. Previously a discount was only
-- annotated in transactions.notes and never reduced the recorded total or the
-- loyalty-earning base. Store it like redeem_value: a percent for reference and
-- the derived rupiah amount, both settled server-side at checkout.
ALTER TABLE transactions ADD COLUMN discount_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
