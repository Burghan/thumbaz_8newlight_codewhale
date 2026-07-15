const express = require('express');
const db = require('../db');

const router = express.Router();

// POS add-ons (e.g. "Extra Shot"). The POS UI expects each modifier as
// { id, name, price_delta } and only ever shows active ones; delete is a
// soft-disable so past receipts that reference a modifier stay intact.

router.get('/', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, price_delta FROM modifiers WHERE active = 1 ORDER BY name'
  ).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const priceDelta = Math.round(Number(req.body?.price_delta || 0));
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!Number.isFinite(priceDelta)) return res.status(400).json({ error: 'Valid price required' });
  const info = db.prepare('INSERT INTO modifiers (name, price_delta) VALUES (?, ?)').run(name, priceDelta);
  res.json({ id: info.lastInsertRowid, name, price_delta: priceDelta });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  const priceDelta = Math.round(Number(req.body?.price_delta || 0));
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!Number.isFinite(priceDelta)) return res.status(400).json({ error: 'Valid price required' });
  const cur = db.prepare('SELECT id FROM modifiers WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Modifier not found' });
  db.prepare('UPDATE modifiers SET name = ?, price_delta = ? WHERE id = ?').run(name, priceDelta, id);
  res.json({ id, name, price_delta: priceDelta });
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
