const express = require('express');
const db = require('../db');

const router = express.Router();

// { product_id, count } per product
router.get('/summary', (_req, res) => {
  res.json(db.prepare('SELECT product_id, COUNT(*) AS count FROM recipes GROUP BY product_id').all());
});

// Recipe lines for one product (name + base unit come from the ingredient)
router.get('/:product_id', (req, res) => {
  const rows = db.prepare(
    `SELECT i.id AS ingredient_id, i.name, i.base_unit AS unit, r.quantity
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
