-- 005: managed list of menu categories (CRUD). Products still store the
-- category as text; this table is the controlled vocabulary + ordering.
CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- seed from categories already used by products
INSERT OR IGNORE INTO product_categories (name)
  SELECT DISTINCT category FROM products
  WHERE category IS NOT NULL AND TRIM(category) <> '';
