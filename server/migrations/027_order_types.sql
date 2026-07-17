-- Order types are now data-driven and manageable (were hardcoded in the POS as
-- Dine In / Takeaway / Delivery). Delivery platforms (Grab Food, Go Food) carry
-- a per-item charge the platform deducts from the shop's take — applied at the
-- POS as a discount that reduces the recorded total, matching how the Grab
-- "Riwayat" source records it. Managers edit these on the Order Types page.
CREATE TABLE IF NOT EXISTS order_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,           -- shown in the POS + stored on transactions.order_type
  per_item_discount INTEGER NOT NULL DEFAULT 0,     -- rupiah per item auto-applied at checkout
  active            INTEGER NOT NULL DEFAULT 1,     -- 0 = hidden from the POS (soft delete)
  sort_order        INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT
);

INSERT OR IGNORE INTO order_types (name, per_item_discount, sort_order) VALUES
  ('Dine In',   0, 1),
  ('Takeaway',  0, 2),
  ('Delivery',  0, 3),
  ('Grab Food', 3000, 4),
  ('Go Food',   3000, 5);
