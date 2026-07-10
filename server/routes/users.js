const express = require('express');
const { scryptSync } = require('crypto');
const db = require('../db');
const router = express.Router();
const PIN_SALT = 'coffee2026';

// Inline auth check
function adminOnly(req, res, next) { if (!req.user || req.user.role !== 'admin') return res.status(401).json({ error: 'Admin only' }); next(); }

router.get('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const rows = db.prepare('SELECT id, name, role, active, rate, phone, notes FROM users ORDER BY name').all();
  res.json(rows.map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active, rate: u.rate, phone: u.phone, notes: u.notes })));
});

router.post('/', adminOnly, (req, res) => {
  const { name, role, pin, rate, phone, notes } = req.body || {};
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const hash = pin ? scryptSync(String(pin), PIN_SALT, 64).toString('hex') : null;
  db.prepare('INSERT INTO users (name, role, pin_hash, rate, phone, notes) VALUES (?,?,?,?,?,?)')
    .run(name.trim(), role, Number(rate||0), hash, (phone||'').trim()||null, (notes||'').trim()||null);
  res.json({ message: 'User added' });
});

router.put('/:id', adminOnly, (req, res) => {
  const { name, role, pin, rate, phone, notes } = req.body || {};
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const updates = [];
  const params = [];
  updates.push('name = ?'); params.push(name.trim());
  updates.push('role = ?'); params.push(role);
  updates.push('rate = ?'); params.push(Number(rate||0));
  updates.push('phone = ?'); params.push((phone||'').trim()||null);
  updates.push('notes = ?'); params.push((notes||'').trim()||null);
  if (pin) { updates.push('pin_hash = ?'); params.push(scryptSync(String(pin), PIN_SALT, 64).toString('hex')); }
  params.push(req.params.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'User updated' });
});

router.patch('/:id/toggle', adminOnly, (req, res) => {
  const u = db.prepare('SELECT active FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, req.params.id);
  res.json({ message: u.active ? 'Deactivated' : 'Reactivated' });
});

module.exports = router;
