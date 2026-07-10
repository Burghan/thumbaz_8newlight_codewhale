const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare(
    `INSERT INTO suppliers (name, contact_name, phone, email, address, notes, active)
     VALUES (?,?,?,?,?,?,1)`
  ).run(
    String(b.name).trim(),
    (b.contact_name || '').trim() || null,
    (b.phone || '').trim() || null,
    (b.email || '').trim() || null,
    (b.address || '').trim() || null,
    (b.notes || '').trim() || null
  );
  res.json({ message: 'Supplier added', id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  db.prepare(
    `UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(
    String(b.name || '').trim(),
    (b.contact_name || '').trim() || null,
    (b.phone || '').trim() || null,
    (b.email || '').trim() || null,
    (b.address || '').trim() || null,
    (b.notes || '').trim() || null,
    req.params.id
  );
  res.json({ message: 'Supplier updated' });
});

router.patch('/:id/archive', (req, res) => {
  db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Supplier archived' });
});

module.exports = router;
