const express = require('express');
const db = require('../db');
const router = express.Router();

// All routes inline (no middleware chaining for Express 5 compat)
router.get('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT inv.*, u.name AS created_by_name
    FROM invoices inv LEFT JOIN users u ON u.id = inv.created_by
    WHERE inv.date = ? ORDER BY inv.id DESC
  `).all(date);
  res.json(rows);
});

router.post('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { items, payment_type, notes } = req.body || {};
  if (!items || !items.length) return res.status(400).json({ error: 'No items' });

  const info = db.prepare(
    `INSERT INTO invoices (date, payment_type, notes, created_by)
     VALUES (date('now'), ?, ?, ?)`
  ).run(payment_type || 'cash', notes || null, req.user.id);

  const invId = info.lastInsertRowid;
  const insItem = db.prepare(
    `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?)`
  );

  let total = 0;
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const price = Math.round(Number(item.unit_price || 0));
    insItem.run(invId, item.product_id, qty, price, qty * price);
    total += qty * price;
  }

  db.prepare('UPDATE invoices SET total_amount = ? WHERE id = ?').run(total, invId);
  res.json({ message: 'Invoice created', id: invId, total });
});

router.get('/:id', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = db.prepare(`
    SELECT ii.*, p.name AS product_name
    FROM invoice_items ii JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = ?
  `).all(req.params.id);
  res.json(inv);
});

router.get('/daily-summary', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const month = req.query.month || new Date().toISOString().slice(0,7);
  const rows = db.prepare(`
    SELECT date, SUM(total_amount) AS revenue, COUNT(*) AS count
    FROM invoices WHERE strftime('%Y-%m', date) = ?
    GROUP BY date ORDER BY date
  `).all(month);
  res.json(rows);
});

module.exports = router;
