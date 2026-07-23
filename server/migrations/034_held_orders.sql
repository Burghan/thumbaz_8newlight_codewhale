-- The POS "Orders" tab (Hold/Save/Paid/Invoice log + reprint picker) was
-- entirely localStorage-backed (pos_held_orders in pos-new.js) — invisible
-- across devices/browsers, so an order one staff member holds on their
-- tablet doesn't show up for a coworker on a different one. This table is
-- the real, shared source of truth it should have been all along.
CREATE TABLE held_orders (
  id              TEXT PRIMARY KEY,   -- the same client-generated UUID used today (state.currentOrderId) — also what kitchen_tickets.order_ref matches on
  label           TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft | ongoing | paid | invoice
  order_type      TEXT,
  customer_name   TEXT,
  cashier_name    TEXT,
  receipt_number  TEXT,
  is_invoice      INTEGER NOT NULL DEFAULT 0,
  sent_to_kitchen INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  items_json      TEXT NOT NULL DEFAULT '[]',
  sale_id         INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
  paid_at         TEXT
);
CREATE INDEX idx_held_orders_status ON held_orders(status);
CREATE INDEX idx_held_orders_updated ON held_orders(updated_at);
