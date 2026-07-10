-- 008: sales tracking — transactions + transaction_items.
-- Records daily POS sales per product.
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transacted_at TEXT NOT NULL DEFAULT (date('now')),
  payment_method TEXT CHECK (payment_method IN ('cash','qris','transfer')) DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  -- Capture the HPP at time of sale for accurate profit calc
  hpp_at_sale INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_txn_items_txn ON transaction_items(transaction_id);
CREATE INDEX idx_txn_items_product ON transaction_items(product_id);
CREATE INDEX idx_txn_date ON transactions(transacted_at);
