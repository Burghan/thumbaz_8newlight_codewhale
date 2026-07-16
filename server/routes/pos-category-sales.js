const express = require('express');
const db = require('../db');

const router = express.Router();

// Total quantity sold per product category, used by the POS to order the
// category chips most-sold first. Staff-accessible (the full reports route is
// manager-gated). Categories with no sales simply won't appear here; the POS
// still shows them, ranked after the ones that have sales.
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.category AS category, SUM(ti.quantity) AS qty
    FROM transaction_items ti
    JOIN products p ON p.id = ti.product_id
    WHERE p.category IS NOT NULL AND p.category != ''
    GROUP BY p.category
    ORDER BY qty DESC
  `).all();
  res.json(rows.map((r) => ({ category: r.category, qty: Number(r.qty) || 0 })));
});

module.exports = router;
