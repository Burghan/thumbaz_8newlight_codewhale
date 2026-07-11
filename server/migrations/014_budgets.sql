-- 014: Monthly budget lines (Budget vs Actual, mirrors the JUNI workbook).
-- Actuals are computed live: revenue<-sales, cogs<-purchases by ingredient
-- category, opex<-expenses by category. This table only stores the BUDGET.
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,              -- 'YYYY-MM'
  kind TEXT NOT NULL,              -- 'revenue' | 'cogs' | 'opex'
  category TEXT NOT NULL,          -- matches ingredient.category (cogs) / expenses.category (opex)
  amount INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(month, kind, category)
);
