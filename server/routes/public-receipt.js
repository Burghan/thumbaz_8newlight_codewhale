const express = require('express');
const db = require('../db');
const { verify } = require('../lib/receiptToken');
const router = express.Router();

// GET /api/public-receipt/:id?t=<token> — the ONLY unauthenticated read of
// sale data in the app, deliberately narrow: just what's already on the
// printed receipt (items/qty/price/total, order type, date), no cashier
// name, no internal notes. Requires the HMAC token so a sequential id can't
// be incremented to browse other customers' receipts.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!verify(id, req.query.t)) return res.status(403).json({ error: 'Invalid or missing receipt link' });

  const txn = db.prepare(`
    SELECT id, transacted_at, payment_method, reference, customer_name, order_type, tax
    FROM transactions WHERE id = ?`).get(id);
  if (!txn) return res.status(404).json({ error: 'Receipt not found' });

  const items = db.prepare(`
    SELECT ti.product_id, ti.quantity, ti.unit_price, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id = ti.product_id
    WHERE ti.transaction_id = ? AND ti.quantity > 0`).all(id);

  const subtotal = items.reduce((sum, i) => sum + i.line_total, 0);

  res.json({
    id: txn.id,
    transacted_at: txn.transacted_at,
    payment_method: txn.payment_method,
    reference: txn.reference,
    customer_name: txn.customer_name,
    order_type: txn.order_type,
    tax: txn.tax || 0,
    subtotal,
    total: subtotal + (txn.tax || 0),
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.unit_price, total: i.line_total }))
  });
});

module.exports = router;
