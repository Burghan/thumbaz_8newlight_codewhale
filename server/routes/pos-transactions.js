const express = require('express');
const db = require('../db');
const router = express.Router();

// Staff-safe mirror of the Transactions page's list + order-detail routes
// (which live under the manager-only /api/transactions and /api/reports),
// hardcoded to TODAY (WIB) — no cost/HPP fields, no arbitrary date range, no
// create/void/fix-qty here (those stay manager-only / posted through the
// existing routes). Lets staff view and reprint today's receipts without
// exposing the rest of /api/reports' analytics.

router.get('/', (req, res) => {
  const { order_type, payment_method, product_id, q, sort, dir } = req.query;

  const clauses = ["date(t.transacted_at) = date('now', '+7 hours')"];
  const params = [];
  if (order_type) { clauses.push('t.order_type = ?'); params.push(order_type); }
  if (payment_method) { clauses.push('t.payment_method = ?'); params.push(payment_method); }
  if (q) { clauses.push('(t.reference LIKE ? OR CAST(t.id AS TEXT) = ?)'); params.push(`%${q}%`, String(q).replace(/^#/, '')); }
  if (product_id) { clauses.push('EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id AND x.product_id = ?)'); params.push(Number(product_id)); }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const kpi = db.prepare(`
    SELECT COUNT(DISTINCT t.id) AS orders, COALESCE(SUM(ti.line_total),0) AS revenue, COALESCE(SUM(ti.quantity),0) AS items
    FROM transactions t LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
    ${where}
  `).get(...params);

  const SORT_COLS = { date: 't.transacted_at', total: 'total', items: 'item_count', id: 't.id' };
  const sortCol = SORT_COLS[sort] || 't.transacted_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));

  const orders = db.prepare(`
    SELECT t.id, t.transacted_at AS date, t.payment_method, t.reference,
           t.order_type, t.tax,
           COALESCE(SUM(ti.line_total),0) AS total,
           COALESCE(SUM(ti.quantity),0) AS item_count,
           COALESCE(SUM(ti.product_discount_amount),0) + COALESCE(t.source_discount_amount,0) AS discount,
           MAX(CASE WHEN ti.status IS NOT NULL AND ti.status <> 'Transaksi' THEN ti.status END) AS status,
           GROUP_CONCAT(p.name || ' ×' || ti.quantity, ', ') AS items_preview
    FROM transactions t
    LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
    LEFT JOIN products p ON p.id = ti.product_id
    ${where}
    GROUP BY t.id
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (pageNum - 1) * pageSize);

  const orderTypes = db.prepare(
    "SELECT DISTINCT order_type FROM transactions WHERE order_type IS NOT NULL AND TRIM(order_type) <> '' AND date(transacted_at) = date('now', '+7 hours') ORDER BY order_type"
  ).all().map(r => r.order_type);

  const paymentMethods = db.prepare(
    "SELECT DISTINCT payment_method FROM transactions WHERE payment_method IS NOT NULL AND TRIM(payment_method) <> '' AND date(transacted_at) = date('now', '+7 hours') ORDER BY payment_method"
  ).all().map(r => r.payment_method);

  res.json({
    orders,
    total: kpi.orders,
    page: pageNum,
    pageSize,
    orderTypes,
    paymentMethods,
    kpi: { revenue: kpi.revenue, orders: kpi.orders, items: kpi.items, avg: kpi.orders ? Math.round(kpi.revenue / kpi.orders) : 0 }
  });
});

// Single order detail — same shape as /api/reports/order/:id, restricted to
// today so staff can't page through arbitrary historical order ids.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order id' });

  const rows = db.prepare(`
    SELECT t.id, t.transacted_at AS date, t.payment_method, t.reference, t.customer_note AS notes,
           ti.id AS item_id, ti.product_id, p.name AS product_name, ti.quantity, ti.unit_price, ti.line_total
    FROM transactions t
    LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
    LEFT JOIN products p ON p.id = ti.product_id
    WHERE t.id = ? AND date(t.transacted_at) = date('now', '+7 hours')
  `).all(id);
  if (!rows.length) return res.status(404).json({ error: 'Order not found (or not from today)' });

  const o = { id: rows[0].id, date: rows[0].date, payment_method: rows[0].payment_method,
              reference: rows[0].reference, notes: rows[0].notes, items: [], total: 0 };
  rows.forEach(r => {
    if (r.product_id != null) {
      o.items.push({ item_id: r.item_id, product_id: r.product_id, product_name: r.product_name, quantity: r.quantity, unit_price: r.unit_price, line_total: r.line_total });
      o.total += r.line_total;
    }
  });
  res.json(o);
});

module.exports = router;
