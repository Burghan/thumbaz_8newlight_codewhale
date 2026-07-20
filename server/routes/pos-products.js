const express = require('express');
const db = require('../db');

const router = express.Router();

// Read-only menu list for the POS register. The full /api/products route is
// manager-gated because it includes cost/margin fields (std_cost_per_item,
// labor/utility/wifi cost); the POS (staff) only needs what it renders on a
// product card, so this is a lean, safe subset exposed to POS roles.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.variant, p.active,
      (SELECT price FROM product_prices pp
        WHERE pp.product_id = p.id AND pp.effective_to IS NULL
        ORDER BY pp.id DESC LIMIT 1) AS price
    FROM products p
    WHERE p.active = 1
    ORDER BY p.name
  `).all();
  res.json(rows.map((r) => ({ ...r, price: r.price || 0 })));
});

module.exports = router;
