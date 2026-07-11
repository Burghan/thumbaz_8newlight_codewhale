-- 015: configurable KPI targets (mirrors the JUNI workbook's KPI Dashboard).
-- direction: 'min' = actual should be >= target_low (higher is better)
--            'max' = actual should be <= target_high (lower is better)
--            'range' = target_low <= actual <= target_high
CREATE TABLE IF NOT EXISTS kpi_targets (
  metric TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  direction TEXT NOT NULL,
  target_low REAL,
  target_high REAL,
  unit TEXT NOT NULL DEFAULT '%',
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO kpi_targets (metric, label, direction, target_low, target_high, unit, sort_order) VALUES
  ('gross_margin', 'Gross Profit %',        'min',   65, NULL, '%', 1),
  ('cogs_ratio',   'COGS %',                'max', NULL,   35, '%', 2),
  ('opex_ratio',   'Operating Expense %',   'max', NULL,   50, '%', 3),
  ('net_margin',   'Net Profit %',          'range', 10,   20, '%', 4);
