const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/receipt — list with filters
router.get('/', (req, res) => {
  const date = req.query.date || '';
  const type = req.query.type || '';
  let where = [];
  let params = [];
  if (date) { where.push("r.date = ?"); params.push(date); }
  if (type) { where.push("r.payment_type = ?"); params.push(type); }
  const rows = db.prepare(`
    SELECT r.*, u.name AS created_by_name
    FROM receipt r LEFT JOIN users u ON u.id = r.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.date DESC, r.id DESC LIMIT 100
  `).all(...params);
  res.json(rows);
});

// POST /api/receipt — create receipt/invoice  
router.post('/', (req, res) => {
  const { date, payment_type, reference, notes, items } = req.body || {};
  if (!items || !items.length) return res.status(400).json({ error: 'No items' });

  const uid = req.user?.id || 1; // fallback
  const info = db.prepare(
    `INSERT INTO receipt (date, payment_type, reference, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(date || new Date().toISOString().slice(0,10), payment_type || 'cash', reference || null, notes || null, uid);

  const receiptId = info.lastInsertRowid;
  const insItem = db.prepare(
    `INSERT INTO receipt_items (receipt_id, product_id, quantity, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?)`
  );

  let total = 0;
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const price = Math.round(Number(item.unit_price || 0));
    const line = qty * price;
    total += line;
    insItem.run(receiptId, item.product_id, qty, price, line);
  }

  // Update total on receipt
  db.prepare('UPDATE receipt SET total_amount = ? WHERE id = ?').run(total, receiptId);

  res.json({ message: 'Receipt created', id: receiptId, total });
});

// GET /api/receipt/:id — single receipt with items
router.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM receipt WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  r.items = db.prepare(`
    SELECT ri.*, p.name AS product_name
    FROM receipt_items ri JOIN products p ON p.id = ri.product_id
    WHERE ri.receipt_id = ?
  `).all(req.params.id);
  res.json(r);
});

module.exports = router;
