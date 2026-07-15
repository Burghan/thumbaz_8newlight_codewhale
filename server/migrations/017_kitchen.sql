-- 017: Kitchen tickets (barista queue / KDS). "Send to Bar" in the New POS
-- concept has always posted to /api/kitchen, but the route never existed —
-- this adds the backing tables so tickets actually reach a barista screen.
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT,
  table_label TEXT,
  order_type TEXT NOT NULL DEFAULT 'dine_in',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kitchen_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_kitchen_items_ticket ON kitchen_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_status ON kitchen_tickets(status);
