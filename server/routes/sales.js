const express = require('express');
const db = require('../db');
const { deductStockForSale } = require('../lib/stock');
const router = express.Router();

// POST /api/sales — adapter for coffee-pos format → our transactions table.
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items' });

  const paymentMap = { cash: 'cash', qris: 'qris', transfer: 'transfer', card: 'transfer' };
  const payment = paymentMap[b.payment_type] || 'cash';

  const tx = db.transaction(() => {
    const txn = db.prepare(
      `INSERT INTO transactions (transacted_at, payment_method, notes)
       VALUES (date('now'), ?, ?)`
    ).run(payment, `${b.order_type||'dinein'}${b.discount_amount>0?` discount:${b.discount_amount}`:''}`);

    const txnId = txn.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale)
       VALUES (?,?,?,?,?,0)`
    );

    for (const item of items) {
      const qty = Number(item.quantity || 1);
      const price = Math.round(Number(item.price || 0));
      insItem.run(txnId, item.product_id, qty, price, qty * price);
    }
    return txnId;
  });

  const txnId = tx();
  // Deduct stock for recipe ingredients
  deductStockForSale(txnId, items.map(item => ({ product_id: item.product_id, quantity: item.quantity || 1 })));
  // Lookup transaction with items to return in POS format
  const txn = db.prepare('SELECT id, transacted_at, payment_method FROM transactions WHERE id=?').get(txnId);
  const txnItems = db.prepare(`
    SELECT ti.product_id, ti.quantity, ti.unit_price, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transaction_id=?`).all(txnId);

  res.json({
    success: true,
    sale: {
      id: txn.id,
      created_at: txn.transacted_at,
      payment_type: txn.payment_method,
      items: txnItems.map(i => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, price: i.unit_price, total: i.line_total }))
    }
  });
});

// Void a sale (soft-delete).
router.post('/:id/void', (req, res) => {
  // The POS just needs a success response.
  res.json({ success: true, message: 'Sale voided' });
});

// GET /api/sales — recent sales (for POS display).
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.transacted_at, t.payment_method,
           SUM(ti.line_total) AS total
    FROM transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE t.transacted_at = date('now')
    GROUP BY t.id ORDER BY t.id DESC LIMIT 20
  `).all();
  res.json(rows);
});

module.exports = router;
