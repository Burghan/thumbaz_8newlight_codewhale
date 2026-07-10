-- 012: payroll — overtime, bonus, deduction per user per month.
CREATE TABLE IF NOT EXISTS payroll (
  user_id INTEGER REFERENCES users(id),
  month TEXT NOT NULL,
  overtime INTEGER DEFAULT 0,
  bonus INTEGER DEFAULT 0,
  deduction INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
