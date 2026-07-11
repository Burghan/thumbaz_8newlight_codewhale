const express = require('express');
const db = require('../db');
const { hashPin } = require('../lib/auth');
const router = express.Router();

// Admin-only guard for mutating actions.
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const rows = db.prepare('SELECT id, name, role, active, rate, phone, notes FROM users ORDER BY name').all();
  res.json(rows);
});

router.post('/', adminOnly, (req, res) => {
  const { name, role, pin, rate, phone, notes } = req.body || {};
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const hash = pin ? hashPin(pin) : null;
  db.prepare('INSERT INTO users (name, role, pin_hash, rate, phone, notes) VALUES (?,?,?,?,?,?)')
    .run(name.trim(), role, hash, Number(rate || 0), (phone || '').trim() || null, (notes || '').trim() || null);
  res.json({ message: 'User added' });
});

router.put('/:id', adminOnly, (req, res) => {
  const { name, role, pin, rate, phone, notes } = req.body || {};
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const updates = ['name = ?', 'role = ?', 'rate = ?', 'phone = ?', 'notes = ?'];
  const params = [name.trim(), role, Number(rate || 0), (phone || '').trim() || null, (notes || '').trim() || null];
  if (pin) { updates.push('pin_hash = ?'); params.push(hashPin(pin)); }
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

// Hard-delete a user (admin only). Cascades payroll + attendance rows.
// Guards: can't delete yourself, can't delete the last active admin.
router.delete('/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.user && Number(req.user.id) === id) return res.status(400).json({ error: "You can't delete your own account" });
  if (u.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;
    if (admins <= 1) return res.status(400).json({ error: "Can't delete the last admin" });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM payroll WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM attendances WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  tx();
  res.json({ message: 'User deleted' });
});

module.exports = router;
