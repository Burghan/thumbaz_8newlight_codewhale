const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0,7);
  const rows = db.prepare(`
    SELECT * FROM expenses WHERE strftime('%Y-%m', date) = ? ORDER BY date DESC, id DESC
  `).all(month);
  res.json(rows);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const amount = Math.round(Number(b.amount || 0));
  if (!b.category || !(amount > 0)) return res.status(400).json({ error: 'Category and amount required' });
  db.prepare(`INSERT INTO expenses (date, category, description, amount, notes) VALUES (?,?,?,?,?)`)
    .run(b.date || new Date().toISOString().slice(0,10), b.category.trim(), (b.description||'').trim(), amount, (b.notes||'').trim()||null);
  res.json({ message: 'Expense recorded' });
});

router.get('/summary', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0,7);
  const row = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM expenses WHERE strftime('%Y-%m', date) = ?`).get(month);
  const byCat = db.prepare(`SELECT category, SUM(amount) AS total FROM expenses WHERE strftime('%Y-%m', date) = ? GROUP BY category ORDER BY total DESC`).all(month);
  res.json({ ...row, by_category: byCat });
});

module.exports = router;
