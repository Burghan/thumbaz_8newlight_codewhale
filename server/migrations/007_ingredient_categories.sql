-- 007: managed list of ingredient categories (CRUD).
CREATE TABLE IF NOT EXISTS ingredient_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- seed from categories already used by ingredients
INSERT OR IGNORE INTO ingredient_categories (name)
  SELECT DISTINCT category FROM ingredients
  WHERE category IS NOT NULL AND TRIM(category) <> '';
