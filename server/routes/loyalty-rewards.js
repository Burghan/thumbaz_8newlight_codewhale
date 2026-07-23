const express = require('express');
const db = require('../db');

const router = express.Router();

function managerOnly(req, res, next) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Manager or admin only' });
  }
  next();
}

// GET /api/loyalty-rewards — the catalog. Active only by default (what the
// POS shows customers); ?all=1 returns everything including inactive rows,
// for the Loyalty Setup screen to manage.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = req.query.all
    ? db.prepare('SELECT * FROM loyalty_rewards ORDER BY sort_order, id').all()
    : db.prepare('SELECT * FROM loyalty_rewards WHERE active = 1 ORDER BY sort_order, id').all();
  res.json({ rewards: rows });
});

// Rupiah-off value redeeming this reward takes off the CURRENT bill (only
// meaningful when redeemed mid-Payment) — null/0 for physical handovers
// like Merchandise/Alat Kopi/Rokpresso that don't touch the sale total.
function parseDiscountValue(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// POST /api/loyalty-rewards — admin/manager only, add a reward.
router.post('/', managerOnly, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  const pointsCost = Math.floor(Number(req.body?.points_cost));
  const discountValue = parseDiscountValue(req.body?.discount_value);
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!Number.isFinite(pointsCost) || pointsCost < 1) {
    return res.status(400).json({ error: 'Points cost must be at least 1' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM loyalty_rewards').get().m;
  const info = db.prepare(
    'INSERT INTO loyalty_rewards (name, description, points_cost, discount_value, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(name, description, pointsCost, discountValue, maxOrder + 1);
  res.json({ reward: db.prepare('SELECT * FROM loyalty_rewards WHERE id = ?').get(info.lastInsertRowid) });
});

// PUT /api/loyalty-rewards/:id — admin/manager only, edit name/description/cost/active/discount_value.
router.put('/:id', managerOnly, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM loyalty_rewards WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Reward not found' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const description = req.body?.description !== undefined ? (String(req.body.description).trim() || null) : existing.description;
  const pointsCost = req.body?.points_cost !== undefined ? Math.floor(Number(req.body.points_cost)) : existing.points_cost;
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
  const discountValue = req.body?.discount_value !== undefined ? parseDiscountValue(req.body.discount_value) : existing.discount_value;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!Number.isFinite(pointsCost) || pointsCost < 1) {
    return res.status(400).json({ error: 'Points cost must be at least 1' });
  }
  db.prepare(
    `UPDATE loyalty_rewards SET name = ?, description = ?, points_cost = ?, active = ?, discount_value = ?, updated_at = datetime('now', '+7 hours') WHERE id = ?`
  ).run(name, description, pointsCost, active, discountValue, id);
  res.json({ reward: db.prepare('SELECT * FROM loyalty_rewards WHERE id = ?').get(id) });
});

// DELETE /api/loyalty-rewards/:id — admin/manager only. Past redemptions keep
// their own name/points snapshot, so this doesn't corrupt redemption history.
router.delete('/:id', managerOnly, (req, res) => {
  db.prepare('DELETE FROM loyalty_rewards WHERE id = ?').run(Number(req.params.id));
  res.json({ message: 'Reward removed' });
});

// POST /api/loyalty-rewards/:id/redeem — spend a customer's points on a
// reward. Staff-doable (posRole router-level) — no manager PIN, same as any
// other already-earned-points spend.
router.post('/:id/redeem', (req, res) => {
  const id = Number(req.params.id);
  const customerId = Number(req.body?.customer_id);
  const notes = String(req.body?.notes || '').trim() || null;
  const reward = db.prepare('SELECT * FROM loyalty_rewards WHERE id = ? AND active = 1').get(id);
  if (!reward) return res.status(404).json({ error: 'Reward not found or inactive' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  if (customer.points_balance < reward.points_cost) {
    return res.status(400).json({ error: `Not enough points — needs ${reward.points_cost}, has ${customer.points_balance}` });
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE customers SET points_balance = points_balance - ?, updated_at = datetime('now') WHERE id = ?`)
      .run(reward.points_cost, customerId);
    db.prepare(
      `INSERT INTO loyalty_redemptions (customer_id, reward_id, reward_name, points_cost, redeemed_by, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(customerId, reward.id, reward.name, reward.points_cost, req.user?.name || null, notes);
  });
  tx();
  const updatedCustomer = db.prepare('SELECT id, name, member_id, points_balance FROM customers WHERE id = ?').get(customerId);
  res.json({ message: 'Redeemed', customer: updatedCustomer, discount_value: reward.discount_value || 0 });
});

// GET /api/loyalty-rewards/redemptions/:customerId — a customer's redemption history.
router.get('/redemptions/:customerId', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM loyalty_redemptions WHERE customer_id = ? ORDER BY id DESC LIMIT 50'
  ).all(Number(req.params.customerId));
  res.json({ redemptions: rows });
});

module.exports = router;
