-- Riwayat Transaksi import previously kept only the columns revenue math
-- needed and discarded the rest. Capture the full export instead. Named
-- distinctly from the POS's own discount/loyalty columns (discount_amount,
-- redeem_points/redeem_value) since these describe what the *source* system
-- recorded, not our own checkout.
ALTER TABLE transactions ADD COLUMN cashier_name TEXT;
ALTER TABLE transactions ADD COLUMN customer_name TEXT;
ALTER TABLE transactions ADD COLUMN order_type TEXT;
ALTER TABLE transactions ADD COLUMN source_discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN source_discount_type TEXT;
ALTER TABLE transactions ADD COLUMN source_redeem_poin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN service_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN tax INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN payment_code TEXT;
ALTER TABLE transactions ADD COLUMN source_reference TEXT;

-- quantity/line_total stay net-of-cancellation (everything else in the app
-- assumes quantity = units actually sold); original_quantity/cancelled_quantity
-- preserve the source's raw Jumlah Produk / Jumlah Dibatalkan for audit.
ALTER TABLE transaction_items ADD COLUMN status TEXT;
ALTER TABLE transaction_items ADD COLUMN modifier_notes TEXT;
ALTER TABLE transaction_items ADD COLUMN price_type TEXT;
ALTER TABLE transaction_items ADD COLUMN product_discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transaction_items ADD COLUMN product_discount_type TEXT;
ALTER TABLE transaction_items ADD COLUMN original_quantity INTEGER;
ALTER TABLE transaction_items ADD COLUMN cancelled_quantity INTEGER NOT NULL DEFAULT 0;
