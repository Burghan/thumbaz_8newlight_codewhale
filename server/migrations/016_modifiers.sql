-- 016: POS modifiers (add-ons like "Extra Shot"). The POS UI (pos.html) was
-- fully built for this — per-item "Add modifier" picker + a Manage Modifiers
-- drawer — but /api/modifiers was only a stub returning []. This adds the
-- backing table so modifiers load, save, and can be attached to line items.
-- price_delta is whole rupiah (integer), matching product prices.
CREATE TABLE IF NOT EXISTS modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the common add-on the user asked for. Price is editable in POS →
-- Manage Modifiers; 6000 matches the standalone "Extra Shot Espresso" price.
INSERT INTO modifiers (name, price_delta)
  SELECT 'Extra Shot', 6000
  WHERE NOT EXISTS (SELECT 1 FROM modifiers WHERE LOWER(name) = 'extra shot');
