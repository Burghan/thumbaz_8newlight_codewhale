-- 022: loyalty point redemption. Points could be earned (021) but never spent —
-- this records a redemption on the sale so a Void can hand the points back,
-- mirroring how points_earned is reversed. redeem_value is the rupiah discount
-- the redeemed points bought (computed server-side at a fixed rate).
ALTER TABLE transactions ADD COLUMN redeem_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN redeem_value INTEGER NOT NULL DEFAULT 0;
