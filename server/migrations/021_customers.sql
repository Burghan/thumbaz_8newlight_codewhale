-- 021: real customers + loyalty backing. The New POS UI (Customer picker,
-- member-ID lookup, points display) was fully built against a /api/customers
-- contract that never existed on the server — this adds it.
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  member_id TEXT UNIQUE,
  phone TEXT,
  email TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Link a sale to the customer it was rung up for, and record exactly how many
-- points that sale earned so a later Void can reverse the award precisely
-- (rather than recomputing, which could drift if loyalty rates change later).
ALTER TABLE transactions ADD COLUMN customer_id INTEGER REFERENCES customers(id);
ALTER TABLE transactions ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0;
