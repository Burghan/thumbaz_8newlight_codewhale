const express = require('express');
const db = require('../db');

const router = express.Router();

// COGS/HPP is computed from the recipe using each ingredient's latest-price
// cost per base unit (std_cost_per_base_micro). Overheads add on top.
const LIST_SQL = `
  SELECT
    p.*,
    (SELECT price FROM product_prices pp
      WHERE pp.product_id = p.id AND pp.effective_to IS NULL
      ORDER BY pp.id DESC LIMIT 1) AS price,
    COALESCE((SELECT ROUND(SUM(r.quantity * i.std_cost_per_base_micro) / 1e6)
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
      WHERE r.product_id = p.id), 0) AS ingredient_cogs
  FROM products p
`;

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    variant: row.variant,
    price: row.price || 0,
    labor_cost: row.labor_cost,
    utility_cost: row.utility_cost,
    wifi_cost: row.packaging_cost,        // legacy field name used by menu.html
    std_cost_per_item: row.ingredient_cogs, // recipe COGS (latest-price based)
    notes: row.notes,
    active: row.active
  };
}

router.get('/', (req, res) => {
  const includeArchived = req.query.include_archived === '1';
  const rows = db.prepare(
    `${LIST_SQL} ${includeArchived ? '' : 'WHERE p.active = 1'} ORDER BY p.name`
  ).all();
  res.json(rows.map(serialize));
});

function setPrice(productId, sellingPrice) {
  const price = Math.round(Number(sellingPrice || 0));
  if (!(price > 0)) return;
  const cur = db.prepare(
    'SELECT price FROM product_prices WHERE product_id = ? AND effective_to IS NULL ORDER BY id DESC LIMIT 1'
  ).get(productId);
  if (!cur || cur.price !== price) {
    db.prepare("UPDATE product_prices SET effective_to = datetime('now') WHERE product_id = ? AND effective_to IS NULL").run(productId);
    db.prepare('INSERT INTO product_prices (product_id, price) VALUES (?, ?)').run(productId, price);
  }
}

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare(
    `INSERT INTO products (name, category, variant, labor_cost, utility_cost, packaging_cost, notes, active)
     VALUES (?,?,?,?,?,?,?,1)`
  ).run(
    String(b.name).trim(), (b.category || '').trim() || null, (b.variant || '').trim() || null,
    Math.round(Number(b.labor_cost || 0)), Math.round(Number(b.utility_cost || 0)), Math.round(Number(b.wifi_cost || 0)),
    (b.notes || '').trim() || null
  );
  setPrice(info.lastInsertRowid, b.selling_price ?? b.price);
  res.json({ message: 'Product added', id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  db.prepare(
    `UPDATE products SET name = ?, category = ?, variant = ?, labor_cost = ?, utility_cost = ?,
       packaging_cost = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    String(b.name || '').trim(), (b.category || '').trim() || null, (b.variant || '').trim() || null,
    Math.round(Number(b.labor_cost || 0)), Math.round(Number(b.utility_cost || 0)), Math.round(Number(b.wifi_cost || 0)),
    (b.notes || '').trim() || null, req.params.id
  );
  setPrice(req.params.id, b.selling_price ?? b.price);
  res.json({ message: 'Product updated' });
});

router.patch('/:id/archive', (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Product archived' });
});

router.patch('/:id/restore', (req, res) => {
  db.prepare('UPDATE products SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Product restored' });
});

router.delete('/:id', (req, res) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM recipes WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM product_prices WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  });
  tx();
  res.json({ message: 'Product deleted' });
});

// Image upload not wired in the new app yet.
router.post('/:id/image', (_req, res) => res.json({ message: 'Image upload not supported yet' }));

module.exports = router;
