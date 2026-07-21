-- POS shift/session tracking — the client (pos-new.js) has called
-- /api/sessions/* (open/cash-move/summary/close) since it was built, but no
-- server route or table for it ever existed, so Cash In/Out and Close Shift
-- always silently failed ("Open a session first"). One open session at a
-- time, matching a single physical register/drawer.
CREATE TABLE IF NOT EXISTS pos_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_at      TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
  opened_by      TEXT,
  opening_cash   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at      TEXT,
  closed_by      TEXT,
  counted_cash   INTEGER,
  counted_card   INTEGER,
  counted_qris   INTEGER,
  expected_cash  INTEGER,
  expected_card  INTEGER,
  expected_qris  INTEGER,
  variance_cash  INTEGER,
  variance_card  INTEGER,
  variance_qris  INTEGER,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES pos_sessions(id),
  type        TEXT NOT NULL CHECK (type IN ('in','out')),
  amount      INTEGER NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id);
