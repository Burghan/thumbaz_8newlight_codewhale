const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/customers            -> all customers
// GET /api/customers?member_id= -> exact member_id match (loyalty lookup)
// GET /api/customers?q=         -> search name/phone/email/member_id
router.get('/', (req, res) => {
  const memberId = String(req.query.member_id || '').trim();
  const q = String(req.query.q || '').trim();
  let rows;
  if (memberId) {
    rows = db.prepare('SELECT * FROM customers WHERE member_id = ?').all(memberId);
  } else if (q) {
    const like = `%${q}%`;
    rows = db.prepare(
      `SELECT * FROM customers
       WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR member_id LIKE ?
       ORDER BY name`
    ).all(like, like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM customers ORDER BY name').all();
  }
  res.json({ customers: rows });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ message: 'Customer not found' });
  res.json({ customer });
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const memberId = String(req.body?.member_id || '').trim() || null;
  const phone = String(req.body?.phone || '').trim() || null;
  const email = String(req.body?.email || '').trim() || null;
  if (!name) return res.status(400).json({ message: 'Name required' });
  // Auto-generate member_id if not provided: 5-digit number (00001–99999).
  const finalMemberId = memberId || (() => {
    const last = db.prepare(
      "SELECT member_id FROM customers WHERE member_id GLOB '[0-9][0-9][0-9][0-9][0-9]' ORDER BY member_id DESC LIMIT 1"
    ).get();
    const nextNum = last ? (Number(last.member_id) || 0) + 1 : 1;
    return String(nextNum).padStart(5, '0');
  })();
  if (memberId) {
    const existing = db.prepare('SELECT id FROM customers WHERE member_id = ?').get(finalMemberId);
    if (existing) return res.status(409).json({ message: 'Member ID already in use' });
  }
  const info = db.prepare(
    'INSERT INTO customers (name, member_id, phone, email) VALUES (?, ?, ?, ?)'
  ).run(name, finalMemberId, phone, email);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  res.json({ customer });
});

// PUT /api/customers/:id — update customer fields
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ message: 'Customer not found' });
  const name = String(req.body?.name ?? '').trim() || existing.name;
  const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() || null : existing.phone;
  const email = req.body?.email !== undefined ? String(req.body.email).trim() || null : existing.email;
  db.prepare(
    "UPDATE customers SET name = ?, phone = ?, email = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(name, phone, email, id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  res.json({ customer });
});

// DELETE /api/customers/:id — soft-check before removing
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ message: 'Customer not found' });
  const txns = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE customer_id = ?').get(id);
  if (txns.n > 0) return res.status(409).json({ message: `Cannot delete — customer has ${txns.n} transaction(s) on record.` });
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  res.json({ message: 'Customer deleted' });
});

module.exports = router;
