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
  if (memberId) {
    const existing = db.prepare('SELECT id FROM customers WHERE member_id = ?').get(memberId);
    if (existing) return res.status(409).json({ message: 'Member ID already in use' });
  }
  const info = db.prepare(
    'INSERT INTO customers (name, member_id, phone, email) VALUES (?, ?, ?, ?)'
  ).run(name, memberId, phone, email);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  res.json({ customer });
});

module.exports = router;
