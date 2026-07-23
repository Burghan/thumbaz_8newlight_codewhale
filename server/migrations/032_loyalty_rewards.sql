-- Reward catalog replacing the flat "points -> rupiah off the bill" model.
-- Points are now spent on named rewards, redeemed independently of any sale
-- (redemption is just a log entry + balance deduction; the cashier hands
-- over the item and, for the Menu Credit reward, manually charges any
-- difference if the customer picks something pricier — see description).
CREATE TABLE loyalty_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours'))
);

CREATE TABLE loyalty_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  reward_id INTEGER REFERENCES loyalty_rewards(id),
  reward_name TEXT NOT NULL,
  points_cost INTEGER NOT NULL,
  redeemed_by TEXT,
  notes TEXT,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours'))
);
CREATE INDEX idx_loyalty_redemptions_customer ON loyalty_redemptions(customer_id);

INSERT INTO loyalty_rewards (name, description, points_cost, sort_order) VALUES
  ('Menu Credit (Rp 15.000)', 'Rp 15.000 off any menu item — customer pays the difference if it costs more.', 30, 0),
  ('Merchandise', NULL, 150, 1),
  ('Alat Kopi: Hand Grinder', NULL, 1000, 2),
  ('Alat Kopi: Digital Scale', NULL, 1000, 3),
  ('Alat Kopi: Server', NULL, 1000, 4),
  ('Alat Kopi: V60 Dripper', NULL, 1000, 5),
  ('Alat Kopi: Tamper', NULL, 1000, 6),
  ('Rokpresso', NULL, 1600, 7);

-- The old flat "points -> rupiah off the bill" redemption is replaced by the
-- catalog above; zero this out so any stale client/config can't reactivate it.
UPDATE loyalty_config SET redeem_rate = 0;
