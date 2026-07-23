const express = require('express');
const db = require('../db');
const { verify } = require('../lib/receiptToken');
const router = express.Router();

// GET /api/public-receipt/:id?t=<token> — the ONLY unauthenticated read of
// sale data in the app, deliberately narrow: just what's already on the
// printed receipt (items/qty/price/total, order type, date, cashier — the
// same "Served by" line the in-POS receipt shows), no internal notes.
// Requires the HMAC token so a sequential id can't be incremented to browse
// other customers' receipts.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!verify(id, req.query.t)) return res.status(403).json({ error: 'Invalid or missing receipt link' });

  const txn = db.prepare(`
    SELECT id, transacted_at, payment_method, reference, customer_name, cashier_name, order_type, tax,
           points_earned, redeem_points, redeem_value, discount_amount, customer_id
    FROM transactions WHERE id = ?`).get(id);
  if (!txn) return res.status(404).json({ error: 'Receipt not found' });

  const customer = txn.customer_id
    ? db.prepare('SELECT name, points_balance FROM customers WHERE id = ?').get(txn.customer_id)
    : null;

  const items = db.prepare(`
    SELECT ti.product_id, ti.quantity, ti.unit_price, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id = ti.product_id
    WHERE ti.transaction_id = ? AND ti.quantity > 0`).all(id);

  const subtotal = items.reduce((sum, i) => sum + i.line_total, 0);
  const discountAmount = txn.discount_amount || 0;
  const redeemValue = txn.redeem_value || 0;

  res.json({
    id: txn.id,
    transacted_at: txn.transacted_at,
    payment_method: txn.payment_method,
    reference: txn.reference,
    customer_name: txn.customer_name || (customer ? customer.name : null),
    cashier_name: txn.cashier_name,
    order_type: txn.order_type,
    tax: txn.tax || 0,
    points_earned: txn.points_earned || 0,
    redeem_points: txn.redeem_points || 0,
    redeem_value: redeemValue,
    discount_amount: discountAmount,
    points_balance: customer ? customer.points_balance : null,
    subtotal,
    total: Math.max(0, subtotal - discountAmount + (txn.tax || 0) - redeemValue),
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.unit_price, total: i.line_total }))
  });
});

module.exports = router;
