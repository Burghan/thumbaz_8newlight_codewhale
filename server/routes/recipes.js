const express = require('express');
const db = require('../db');

const router = express.Router();

// { product_id, count } per product
router.get('/summary', (_req, res) => {
  res.json(db.prepare('SELECT product_id, COUNT(*) AS count FROM recipes GROUP BY product_id').all());
});

// All recipes grouped by product — for the master recipe table view.
router.get('/all', (req, res) => {
  const includeNoRecipe = req.query.include_norecipe !== '0'; // default: include all

  // Get all products with their recipe lines + costs.
  const rows = db.prepare(`
    SELECT p.id AS product_id, p.name AS product_name, p.category, p.variant,
           (SELECT price FROM product_prices pp
             WHERE pp.product_id = p.id AND pp.effective_to IS NULL
             ORDER BY pp.id DESC LIMIT 1) AS price,
           p.labor_cost, p.utility_cost, p.packaging_cost, p.is_resale,
           i.id AS ingredient_id, i.name AS ingredient_name, i.base_unit AS unit,
           r.quantity,
           CAST(i.std_cost_per_base_micro AS REAL) / 1e6 AS cost_per_base,
           CAST(r.quantity * i.std_cost_per_base_micro AS REAL) / 1e6 AS line_cost
    FROM products p
    LEFT JOIN recipes r ON r.product_id = p.id
    LEFT JOIN ingredients i ON i.id = r.ingredient_id
    WHERE p.active = 1
    ORDER BY p.category, p.name, i.name
  `).all();

  // Group by product_id.
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.product_id)) {
      grouped.set(row.product_id, {
        product_id: row.product_id,
        name: row.product_name,
        category: row.category || '',
        variant: row.variant || '',
        price: row.price || 0,
        labor_cost: row.labor_cost || 0,
        utility_cost: row.utility_cost || 0,
        packaging_cost: row.packaging_cost || 0,
        is_resale: row.is_resale || 0,
        ingredients: [],
        ingredient_cogs: 0
      });
    }
    const product = grouped.get(row.product_id);
    if (row.ingredient_id) {
      product.ingredients.push({
        ingredient_id: row.ingredient_id,
        name: row.ingredient_name,
        unit: row.unit,
        quantity: row.quantity,
        cost_per_base: row.cost_per_base,
        line_cost: row.line_cost
      });
      product.ingredient_cogs += Number(row.line_cost || 0);
    }
  }

  let result = [...grouped.values()];

  // Filter: show only products with recipes.
  if (!includeNoRecipe) {
    result = result.filter(p => p.ingredients.length > 0);
  }

  // Add HPP totals per product.
  result.forEach(p => {
    p.hpp_total = p.ingredient_cogs + p.labor_cost + p.utility_cost + p.packaging_cost;
    p.profit = p.price - p.hpp_total;
    p.margin_pct = p.price > 0 ? Math.round((p.profit / p.price) * 100) : (p.price === 0 ? null : 0);
  });

  res.json(result);
});

// Recipe lines for one product — includes cost data for HPP display.
router.get('/:product_id', (req, res) => {
  const rows = db.prepare(
    `SELECT i.id AS ingredient_id, i.name, i.base_unit AS unit,
            r.quantity,
            i.std_cost_per_base_micro,
            CAST(i.std_cost_per_base_micro AS REAL) / 1e6 AS cost_per_base,
            CAST(r.quantity * i.std_cost_per_base_micro AS REAL) / 1e6 AS line_cost
       FROM recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
      WHERE r.product_id = ?
      ORDER BY i.name`
  ).all(req.params.product_id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { product_id, ingredient_id, quantity } = req.body || {};
  if (!product_id || !ingredient_id) {
    return res.status(400).json({ error: 'product_id and ingredient_id required' });
  }
  db.prepare(
    `INSERT INTO recipes (product_id, ingredient_id, quantity)
     VALUES (?,?,?)
     ON CONFLICT(product_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity`
  ).run(product_id, ingredient_id, Number(quantity || 0));
  res.json({ message: 'Recipe saved' });
});

router.delete('/', (req, res) => {
  const { product_id, ingredient_id } = req.body || {};
  db.prepare('DELETE FROM recipes WHERE product_id = ? AND ingredient_id = ?')
    .run(product_id, ingredient_id);
  res.json({ message: 'Recipe item removed' });
});

// Bulk upsert (used by "apply recipe to variants")
router.post('/bulk', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const stmt = db.prepare(
    `INSERT INTO recipes (product_id, ingredient_id, quantity)
     VALUES (?,?,?)
     ON CONFLICT(product_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity`
  );
  const tx = db.transaction(() => rows.forEach(r => stmt.run(r.product_id, r.ingredient_id, Number(r.quantity || 0))));
  tx();
  res.json({ message: `Applied ${rows.length} recipe row(s)` });
});

module.exports = router;
