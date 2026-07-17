const express = require('express');
const db = require('../db');

const router = express.Router();

const isManager = (req) => req.user && ['admin', 'manager'].includes(req.user.role);
const rowOf = (r) => ({ id: r.id, name: r.name, per_item_discount: r.per_item_discount, active: !!r.active, sort_order: r.sort_order });

// Parse+validate a name and a non-negative rupiah per-item discount from a body.
function parseBody(b) {
  const name = String(b.name || '').trim();
  const perItem = Math.round(Number(b.per_item_discount));
  if (!name) return { error: 'Name is required' };
  if (!Number.isFinite(perItem) || perItem < 0) return { error: 'Per-item discount must be 0 or more' };
  return { name, perItem };
}

// GET /api/order-types — staff-readable so the POS can populate its picker and
// know each type's per-item charge. ?all=1 (manager view) includes disabled ones.
router.get('/', (req, res) => {
  const all = req.query.all === '1' && isManager(req);
  const rows = db.prepare(
    `SELECT id, name, per_item_discount, active, sort_order FROM order_types
     ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, name`
  ).all();
  res.json({ orderTypes: rows.map(rowOf) });
});

// POST /api/order-types — manager-only; add a new order type / delivery platform.
router.post('/', (req, res) => {
  if (!isManager(req)) return res.status(403).json({ error: 'Insufficient role' });
  const { name, perItem, error } = parseBody(req.body || {});
  if (error) return res.status(400).json({ error });
  const exists = db.prepare('SELECT id FROM order_types WHERE LOWER(name) = LOWER(?)').get(name);
  if (exists) return res.status(409).json({ error: 'An order type with that name already exists' });
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM order_types').get().m;
  const info = db.prepare(
    "INSERT INTO order_types (name, per_item_discount, sort_order, updated_at) VALUES (?,?,?,datetime('now'))"
  ).run(name, perItem, maxSort + 1);
  res.json({ orderType: rowOf(db.prepare('SELECT * FROM order_types WHERE id = ?').get(info.lastInsertRowid)) });
});

// PUT /api/order-types/:id — manager-only; edit name / per-item discount / active.
router.put('/:id', (req, res) => {
  if (!isManager(req)) return res.status(403).json({ error: 'Insufficient role' });
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM order_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Order type not found' });
  const { name, perItem, error } = parseBody(req.body || {});
  if (error) return res.status(400).json({ error });
  const clash = db.prepare('SELECT id FROM order_types WHERE LOWER(name) = LOWER(?) AND id <> ?').get(name, id);
  if (clash) return res.status(409).json({ error: 'Another order type already uses that name' });
  const active = req.body.active === undefined ? existing.active : (req.body.active ? 1 : 0);
  db.prepare(
    "UPDATE order_types SET name = ?, per_item_discount = ?, active = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(name, perItem, active, id);
  res.json({ orderType: rowOf(db.prepare('SELECT * FROM order_types WHERE id = ?').get(id)) });
});

// DELETE /api/order-types/:id — manager-only; soft-disable (active = 0) so any
// past transactions keep their label. Hard-deletes only if it was never seeded
// data and you truly want it gone? Kept simple: always soft-disable.
router.delete('/:id', (req, res) => {
  if (!isManager(req)) return res.status(403).json({ error: 'Insufficient role' });
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM order_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Order type not found' });
  db.prepare("UPDATE order_types SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
