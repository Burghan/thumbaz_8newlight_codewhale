const express = require('express');
const db = require('../db');

const router = express.Router();

// POS add-ons (e.g. "Extra Shot"). The POS UI expects each modifier as
// { id, name, price_delta } and only ever shows active ones; delete is a
// soft-disable so past receipts that reference a modifier stay intact.

// product_id (nullable) links a modifier to a menu product whose recipe is
// deducted when the modifier is sold (Option A). Coerce '' / 0 / bad input to
// null so "price-only" modifiers stay unlinked.
function normalizeProductId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get('/', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, price_delta, product_id FROM modifiers WHERE active = 1 ORDER BY name'
  ).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const priceDelta = Math.round(Number(req.body?.price_delta || 0));
  const productId = normalizeProductId(req.body?.product_id);
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!Number.isFinite(priceDelta)) return res.status(400).json({ error: 'Valid price required' });
  const info = db.prepare('INSERT INTO modifiers (name, price_delta, product_id) VALUES (?, ?, ?)')
    .run(name, priceDelta, productId);
  res.json({ id: info.lastInsertRowid, name, price_delta: priceDelta, product_id: productId });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  const priceDelta = Math.round(Number(req.body?.price_delta || 0));
  const productId = normalizeProductId(req.body?.product_id);
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!Number.isFinite(priceDelta)) return res.status(400).json({ error: 'Valid price required' });
  const cur = db.prepare('SELECT id FROM modifiers WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Modifier not found' });
  db.prepare('UPDATE modifiers SET name = ?, price_delta = ?, product_id = ? WHERE id = ?')
    .run(name, priceDelta, productId, id);
  res.json({ id, name, price_delta: priceDelta, product_id: productId });
});

// Soft-disable — hides it from POS but keeps it referenceable in history.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT id FROM modifiers WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Modifier not found' });
  db.prepare('UPDATE modifiers SET active = 0 WHERE id = ?').run(id);
  res.json({ message: 'Modifier disabled' });
});

module.exports = router;
