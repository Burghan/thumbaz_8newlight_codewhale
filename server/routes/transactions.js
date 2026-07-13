const express = require('express');
const db = require('../db');
const router = express.Router();

// List transactions with items.
router.get('/', (req, res) => {
  const date = req.query.date || '';
  // transacted_at is a full timestamp ('YYYY-MM-DD HH:MM:SS'); a plain date
  // string would never exact-match it, so this filters by calendar day.
  let where = '';
  if (date) where = `WHERE date(t.transacted_at) = ?`;
  const rows = db.prepare(`
    SELECT t.id, t.transacted_at AS date, t.payment_method, t.reference, t.notes,
           ti.id AS item_id, ti.product_id, p.name AS product_name,
           ti.quantity, ti.unit_price, ti.line_total, ti.hpp_at_sale
    FROM transactions t
    LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
    LEFT JOIN products p ON p.id = ti.product_id
    ${where}
    ORDER BY t.transacted_at DESC, t.id DESC
  `).all(...(date ? [date] : []));

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.id)) grouped.set(r.id, {
      id: r.id, date: r.date, payment_method: r.payment_method,
      reference: r.reference, notes: r.notes, items: [], total: 0
    });
    const t = grouped.get(r.id);
    if (r.item_id) {
      t.items.push({ id: r.item_id, product_id: r.product_id, product_name: r.product_name, quantity: r.quantity, unit_price: r.unit_price, line_total: r.line_total });
      t.total += r.line_total;
    }
  }
  res.json([...grouped.values()]);
});

// Daily summary.
router.get('/daily-summary', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  // Group by calendar day, not the full timestamp — transacted_at includes a
  // time component, so grouping by it directly produced one row per
  // transaction instead of one row per day.
  const rows = db.prepare(`
    SELECT date(t.transacted_at) AS date, SUM(ti.line_total) AS revenue, COUNT(DISTINCT t.id) AS txns,
           SUM(ti.quantity) AS items_sold
    FROM transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE strftime('%Y-%m', t.transacted_at) = ?
    GROUP BY date(t.transacted_at) ORDER BY date(t.transacted_at)
  `).all(month);
  res.json(rows);
});

// Create transaction.
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items' });

  const tx = db.transaction(() => {
    const txn = db.prepare(
      `INSERT INTO transactions (transacted_at, payment_method, reference, notes)
       VALUES (?,?,?,?)`
    ).run(b.date || new Date().toISOString().slice(0,10), b.payment_method||'cash', b.reference||null, (b.notes||'').trim()||null);
    const txnId = txn.lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale)
       VALUES (?,?,?,?,?,?)`
    );
    for (const item of items) {
      const qty = Number(item.quantity||1);
      const price = Number(item.unit_price||0);
      const lineTotal = qty * price;
      // Get current HPP for this product
      const hpp = db.prepare(`
        SELECT COALESCE((SELECT ROUND(SUM(r.quantity * i.std_cost_per_base_micro)/1e6)
          FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=p.id),0)
          + p.labor_cost + p.utility_cost + p.packaging_cost AS hpp
        FROM products p WHERE p.id=?`).get(item.product_id);
      insItem.run(txnId, item.product_id, qty, Math.round(price), Math.round(lineTotal), hpp ? Math.round(hpp.hpp) : 0);
    }
    return txnId;
  });
  const txnId = tx();
  res.json({ message: 'Sale recorded', id: txnId });
});

module.exports = router;
