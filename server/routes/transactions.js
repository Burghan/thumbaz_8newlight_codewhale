const express = require('express');
const db = require('../db');
const router = express.Router();

// List transactions with items.
// Legacy mode (used by Dashboard/Analytics drill-down): ?date=YYYY-MM-DD only,
// returns a bare array with each order's full items[] — response shape kept
// exactly as-is so those callers don't need to change.
// List mode (used by the Transactions page): presence of `page` switches to
// filterable/sortable/paginated summary rows — { orders, total, kpi }.
router.get('/', (req, res) => {
  const { date, from, to, order_type, payment_method, product_id, q, sort, dir, page } = req.query;

  if (!page) {
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
    return res.json([...grouped.values()]);
  }

  const clauses = [];
  const params = [];
  if (from) { clauses.push('date(t.transacted_at) >= ?'); params.push(from); }
  if (to) { clauses.push('date(t.transacted_at) <= ?'); params.push(to); }
  if (order_type) { clauses.push('t.order_type = ?'); params.push(order_type); }
  if (payment_method) { clauses.push('t.payment_method = ?'); params.push(payment_method); }
  if (q) { clauses.push('(t.reference LIKE ? OR CAST(t.id AS TEXT) = ?)'); params.push(`%${q}%`, String(q).replace(/^#/, '')); }
  if (product_id) { clauses.push('EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id AND x.product_id = ?)'); params.push(Number(product_id)); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const kpi = db.prepare(`
    SELECT COUNT(DISTINCT t.id) AS orders, COALESCE(SUM(ti.line_total),0) AS revenue, COALESCE(SUM(ti.quantity),0) AS items
    FROM transactions t LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
    ${where}
  `).get(...params);

  const SORT_COLS = { date: 't.transacted_at', total: 'total', items: 'item_count', id: 't.id' };
  const sortCol = SORT_COLS[sort] || 't.transacted_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
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

  // Distinct order types for the filter dropdown (full list, independent of the
  // current filters so options never vanish when one is selected).
  const orderTypes = db.prepare(
    "SELECT DISTINCT order_type FROM transactions WHERE order_type IS NOT NULL AND TRIM(order_type) <> '' ORDER BY order_type"
  ).all().map(r => r.order_type);

  // Same pattern as orderTypes above: independent of the current filters so
  // the dropdown's own options never vanish when one is selected.
  const paymentMethods = db.prepare(
    "SELECT DISTINCT payment_method FROM transactions WHERE payment_method IS NOT NULL AND TRIM(payment_method) <> '' ORDER BY payment_method"
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
