-- 010: employee attendance with photo proof.
CREATE TABLE IF NOT EXISTS attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  photo_in TEXT,
  photo_out TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attendances_date ON attendances(date(clock_in));
