-- Loyalty program setup, previously hardcoded in sales.js as
--   LOYALTY_BASE=10000, LOYALTY_RATE=1, REDEEM_RATE=100.
-- Single editable row (id is pinned to 1) so managers can define how the
-- program applies: how many points are earned per rupiah spent, and what one
-- point is worth when redeemed. sales.js reads this row at checkout instead of
-- the old constants.
CREATE TABLE IF NOT EXISTS loyalty_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  earn_base   INTEGER NOT NULL DEFAULT 10000,  -- spend this many rupiah...
  earn_points INTEGER NOT NULL DEFAULT 1,      -- ...to earn this many points
  redeem_rate INTEGER NOT NULL DEFAULT 100,    -- rupiah discount per point redeemed
  enabled     INTEGER NOT NULL DEFAULT 1,      -- 0 = program off (no earn/redeem)
  updated_at  TEXT
);

INSERT OR IGNORE INTO loyalty_config (id, earn_base, earn_points, redeem_rate, enabled)
VALUES (1, 10000, 1, 100, 1);
