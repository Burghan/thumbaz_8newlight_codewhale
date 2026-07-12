const express = require('express');
const db = require('../db');
const { microToRupiah, costPerBaseMicro } = require('../lib/money');

const router = express.Router();

// Map a DB row to the shape the UI expects (micro-rupiah -> rupiah).
function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    base_unit: row.base_unit,
    unit: row.base_unit,                 // legacy alias used by some pages
    purchase_unit: row.purchase_unit,
    conv_purchase_to_base: row.conv_purchase_to_base,
    last_purchase_price: row.last_purchase_price,
    std_cost_per_base: microToRupiah(row.std_cost_per_base_micro),
    min_stock: row.min_stock,
    notes: row.notes,
    active: row.active
  };
}

router.get('/', (req, res) => {
  const includeArchived = req.query.include_archived === '1';
  const rows = db.prepare(
    `SELECT * FROM ingredients ${includeArchived ? '' : 'WHERE active = 1'} ORDER BY name`
  ).all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'Name required' });
  }
  const conv = b.conv_purchase_to_base ? Number(b.conv_purchase_to_base) : null;
  const lastPrice = b.last_purchase_price != null && b.last_purchase_price !== ''
    ? Math.round(Number(b.last_purchase_price)) : null;
  const costMicro = costPerBaseMicro({
    last_purchase_price: lastPrice,
    conv_purchase_to_base: conv,
    std_cost_per_base: b.std_cost_per_base
  });
  const info = db.prepare(
    `INSERT INTO ingredients
      (name, category, base_unit, purchase_unit, conv_purchase_to_base,
       last_purchase_price, std_cost_per_base_micro, min_stock, notes, active)
     VALUES (?,?,?,?,?,?,?,?,?,1)`
  ).run(
    String(b.name).trim(), b.category || null, (b.base_unit || '').trim() || 'pcs',
    b.purchase_unit || null, conv, lastPrice, costMicro, Number(b.min_stock || 0), b.notes || null
  );
  db.prepare(
    'INSERT OR IGNORE INTO inventory (ingredient_id, quantity_base, avg_cost_micro) VALUES (?,0,?)'
  ).run(info.lastInsertRowid, costMicro);
  res.json({ message: 'Ingredient added', id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ingredient not found' });

  const conv = b.conv_purchase_to_base ? Number(b.conv_purchase_to_base) : null;
  const lastPrice = b.last_purchase_price != null && b.last_purchase_price !== ''
    ? Math.round(Number(b.last_purchase_price)) : null;
  const costMicro = costPerBaseMicro({
    last_purchase_price: lastPrice,
    conv_purchase_to_base: conv,
    std_cost_per_base: b.std_cost_per_base
  });
  db.prepare(
    `UPDATE ingredients SET
       name = ?, category = ?, base_unit = ?, purchase_unit = ?, conv_purchase_to_base = ?,
       last_purchase_price = ?, std_cost_per_base_micro = ?, min_stock = ?, notes = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    String(b.name || '').trim(), b.category || null, (b.base_unit || '').trim() || 'pcs',
    b.purchase_unit || null, conv, lastPrice, costMicro, Number(b.min_stock || 0), b.notes || null,
    req.params.id
  );
  res.json({ message: 'Ingredient updated' });
});

router.patch('/:id/archive', (req, res) => {
  db.prepare('UPDATE ingredients SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Ingredient archived' });
});

router.patch('/:id/restore', (req, res) => {
  db.prepare('UPDATE ingredients SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Ingredient restored' });
});

// Hard delete — blocked when the ingredient is still referenced. Archive instead.
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Ingredient not found' });

  const recipes = db.prepare('SELECT COUNT(*) c FROM recipes WHERE ingredient_id = ?').get(id).c;
  const purchases = db.prepare('SELECT COUNT(*) c FROM purchase_items WHERE ingredient_id = ?').get(id).c;
  const resale = db.prepare('SELECT COUNT(*) c FROM products WHERE resale_ingredient_id = ?').get(id).c;
  const refs = [];
  if (recipes) refs.push(`${recipes} recipe(s)`);
  if (purchases) refs.push(`${purchases} purchase(s)`);
  if (resale) refs.push(`${resale} resale product(s)`);
  if (refs.length) return res.status(409).json({ error: `Cannot delete: in use by ${refs.join(', ')}. Archive it instead.` });

  db.transaction(() => {
    db.prepare('DELETE FROM inventory WHERE ingredient_id = ?').run(id);
    db.prepare('DELETE FROM stock_movements WHERE ingredient_id = ?').run(id);
    db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
  })();
  res.json({ message: 'Ingredient deleted' });
});

module.exports = router;
