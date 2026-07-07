-- 001_init: clean back-office schema for menu / ingredients / recipes / purchasing / inventory
--
-- Money representation (decimal-safe, no floats):
--   * prices / totals / overheads  -> INTEGER rupiah (IDR has no sub-unit in practice)
--   * unit costs (per base unit)    -> INTEGER micro-rupiah (value ÷ 1e6 = rupiah),
--                                      so fractional costs like 0.008606/g are exact.
-- Quantities stay REAL (physical amounts, not money).

-- Reference: normalized measurement units
CREATE TABLE units (
  code TEXT PRIMARY KEY,          -- 'g', 'ml', 'pcs'
  name TEXT NOT NULL
);
INSERT INTO units (code, name) VALUES
  ('g', 'gram'), ('ml', 'milliliter'), ('pcs', 'piece'), ('kg', 'kilogram'), ('l', 'liter');

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  base_unit TEXT NOT NULL,               -- unit used in recipes + inventory (units.code)
  purchase_unit TEXT,                    -- unit used when buying
  conv_purchase_to_base REAL,            -- base units per 1 purchase unit (default 1)
  std_cost_per_base_micro INTEGER NOT NULL DEFAULT 0,  -- micro-rupiah per base unit
  min_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  variant TEXT,
  labor_cost INTEGER NOT NULL DEFAULT 0,      -- rupiah, fixed overhead per item
  utility_cost INTEGER NOT NULL DEFAULT 0,    -- rupiah
  packaging_cost INTEGER NOT NULL DEFAULT 0,  -- rupiah (old app's "wifi"/cup etc.)
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  price INTEGER NOT NULL,                 -- rupiah
  effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  effective_to TEXT
);
CREATE INDEX idx_product_prices_product ON product_prices(product_id);

CREATE TABLE recipes (
  product_id INTEGER NOT NULL REFERENCES products(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity REAL NOT NULL,                 -- in the ingredient's base unit
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  purchase_qty REAL NOT NULL,            -- in purchase unit
  purchase_unit TEXT,
  base_qty REAL NOT NULL,               -- purchase_qty * conv_purchase_to_base
  unit_price INTEGER NOT NULL,          -- rupiah per purchase unit
  line_total INTEGER NOT NULL           -- rupiah
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_ingredient ON purchase_items(ingredient_id);

CREATE TABLE inventory (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id),
  quantity_base REAL NOT NULL DEFAULT 0,          -- on hand, base unit
  avg_cost_micro INTEGER NOT NULL DEFAULT 0,      -- micro-rupiah per base unit (moving avg)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only ledger of every stock change
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  type TEXT NOT NULL CHECK (type IN ('purchase','usage','adjustment','transfer_in','transfer_out','opening')),
  qty_base REAL NOT NULL,                -- signed (+in / -out)
  unit_cost_micro INTEGER,              -- micro-rupiah per base unit at time of move
  ref_type TEXT,                         -- e.g. 'purchase'
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_stock_movements_ingredient ON stock_movements(ingredient_id);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
  pin_hash TEXT,                         -- bcrypt/scrypt hash, never plaintext
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
