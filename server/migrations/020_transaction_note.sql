-- 020: transaction-level customer note. Replaces the removed per-line "Note"
-- numpad chip — a note is now captured once at Payment, for the whole
-- transaction, instead of per line item. Kept separate from the existing
-- `notes` column (already used for order_type/discount bookkeeping) so this
-- stays a clean, queryable customer-facing field.
ALTER TABLE transactions ADD COLUMN customer_note TEXT;
