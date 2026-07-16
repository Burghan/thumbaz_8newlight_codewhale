-- 019: Void audit log. Voids used to hard-delete a sale with no trace; this
-- records each one (what, why, when, and whether ingredients were returned to
-- stock) so a shift's voids are answerable. The transaction is still removed so
-- existing revenue reports stay correct without change; this table is the
-- surviving record.
CREATE TABLE IF NOT EXISTS void_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER,
  total INTEGER NOT NULL DEFAULT 0,       -- rupiah, sale total that was reversed
  items TEXT,                             -- human-readable item summary
  reason TEXT,
  restocked INTEGER NOT NULL DEFAULT 0,   -- 1 = ingredients returned (not made), 0 = kept consumed (already made)
  voided_at TEXT NOT NULL DEFAULT (datetime('now'))
);
