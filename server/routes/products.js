const express = require('express');
const db = require('../db');

const router = express.Router();

// COGS/HPP is computed from the recipe using each ingredient's latest-price
// cost per base unit (std_cost_per_base_micro). Overheads add on top.
// For resale items (is_resale=1), COGS comes from the linked shadow ingredient.
const LIST_SQL = `
  SELECT
    p.*,
    (SELECT price FROM product_prices pp
      WHERE pp.product_id = p.id AND pp.effective_to IS NULL
      ORDER BY pp.id DESC LIMIT 1) AS price,
    CASE WHEN p.is_resale = 1 THEN
      COALESCE((SELECT ri.std_cost_per_base_micro
         FROM ingredients ri WHERE ri.id = p.resale_ingredient_id), 0)
    ELSE
      COALESCE((SELECT ROUND(SUM(r.quantity * i.std_cost_per_base_micro) / 1e6)
         FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.product_id = p.id), 0)
    END AS ingredient_cogs_micro
  FROM products p
`;

function serialize(row) {
  // Resale items: ingredient_cogs_micro is micro-rupiah, divide by 1e6 for rupiah.
  // Recipe items: ingredient_cogs_micro is already rupiah from SUM/1e6 division.
  const ingredientCogs = row.is_resale
    ? (row.ingredient_cogs_micro == null ? 0 : row.ingredient_cogs_micro / 1e6)
    : (row.ingredient_cogs_micro || 0);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    variant: row.variant,
    price: row.price || 0,
    labor_cost: row.labor_cost,
    utility_cost: row.utility_cost,
    wifi_cost: row.packaging_cost,
    std_cost_per_item: ingredientCogs,
    is_resale: row.is_resale,
    resale_ingredient_id: row.resale_ingredient_id,
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

// Create or update the shadow ingredient for a resale product.
function upsertResaleIngredient(productName, buyingPrice, existingIngredientId) {
  const price = Math.round(Number(buyingPrice || 0));
  const costMicro = price > 0 ? Math.round(price * 1e6) : 0;

  if (existingIngredientId) {
    const ing = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(existingIngredientId);
    if (ing) {
      db.prepare(`UPDATE ingredients SET
        name = ?, last_purchase_price = ?, std_cost_per_base_micro = ?,
        updated_at = datetime('now')
        WHERE id = ?`).run(productName, price || null, costMicro, existingIngredientId);
      db.prepare('UPDATE inventory SET avg_cost_micro = ? WHERE ingredient_id = ?')
        .run(costMicro, existingIngredientId);
      return existingIngredientId;
    }
  }

  const info = db.prepare(`INSERT INTO ingredients
    (name, category, base_unit, purchase_unit, conv_purchase_to_base,
     last_purchase_price, std_cost_per_base_micro, min_stock, active)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(
    productName, 'Resale', 'pcs', 'pcs', 1, price || null, costMicro, 0
  );
  const ingId = info.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO inventory (ingredient_id, quantity_base, avg_cost_micro) VALUES (?,0,?)')
    .run(ingId, costMicro);
  return ingId;
}

// Archive the shadow ingredient when a product is un-marked as resale.
function archiveResaleIngredient(ingredientId) {
  if (!ingredientId) return;
  db.prepare('UPDATE ingredients SET active = 0 WHERE id = ?').run(ingredientId);
}

// Delete shadow ingredient (cascade when product is deleted).
function deleteResaleIngredient(ingredientId) {
  if (!ingredientId) return;
  db.prepare('DELETE FROM inventory WHERE ingredient_id = ?').run(ingredientId);
  db.prepare('DELETE FROM stock_movements WHERE ingredient_id = ?').run(ingredientId);
  db.prepare('DELETE FROM purchase_items WHERE ingredient_id = ?').run(ingredientId);
  db.prepare('DELETE FROM recipes WHERE ingredient_id = ?').run(ingredientId);
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(ingredientId);
}

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name required' });

  const isResale = b.is_resale === true || b.is_resale === 1 || b.is_resale === '1';
  const resaleCost = b.resale_cost != null && b.resale_cost !== '' ? Number(b.resale_cost) : 0;
  let resaleIngredientId = null;

  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO products (name, category, variant, labor_cost, utility_cost, packaging_cost, notes, active, is_resale)
       VALUES (?,?,?,?,?,?,?,1,?)`
    ).run(
      String(b.name).trim(), (b.category || '').trim() || null, (b.variant || '').trim() || null,
      Math.round(Number(b.labor_cost || 0)), Math.round(Number(b.utility_cost || 0)), Math.round(Number(b.wifi_cost || 0)),
      (b.notes || '').trim() || null, isResale ? 1 : 0
    );
    const productId = info.lastInsertRowid;

    if (isResale && resaleCost > 0) {
      resaleIngredientId = upsertResaleIngredient(String(b.name).trim(), resaleCost, null);
      db.prepare('UPDATE products SET resale_ingredient_id = ? WHERE id = ?').run(resaleIngredientId, productId);
    }

    return productId;
  });
  const productId = tx();
  setPrice(productId, b.selling_price ?? b.price);
  res.json({ message: 'Product added', id: productId });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT id, is_resale, resale_ingredient_id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const isResale = b.is_resale === true || b.is_resale === 1 || b.is_resale === '1';
  const resaleCost = b.resale_cost != null && b.resale_cost !== '' ? Number(b.resale_cost) : 0;
  let newResaleIngredientId = existing.resale_ingredient_id;

  const tx = db.transaction(() => {
    // Switching FROM resale TO non-resale: archive shadow ingredient.
    if (existing.is_resale && !isResale) {
      archiveResaleIngredient(existing.resale_ingredient_id);
      newResaleIngredientId = null;
    }

    // Switching TO resale, or updating existing resale: create/update shadow ingredient.
    if (isResale && resaleCost > 0) {
      newResaleIngredientId = upsertResaleIngredient(
        String(b.name || '').trim(),
        resaleCost,
        existing.is_resale ? existing.resale_ingredient_id : null
      );
    }

    db.prepare(
      `UPDATE products SET name = ?, category = ?, variant = ?, labor_cost = ?, utility_cost = ?,
         packaging_cost = ?, notes = ?, is_resale = ?, resale_ingredient_id = ?,
         updated_at = datetime('now') WHERE id = ?`
    ).run(
      String(b.name || '').trim(), (b.category || '').trim() || null, (b.variant || '').trim() || null,
      Math.round(Number(b.labor_cost || 0)), Math.round(Number(b.utility_cost || 0)), Math.round(Number(b.wifi_cost || 0)),
      (b.notes || '').trim() || null, isResale ? 1 : 0, newResaleIngredientId, req.params.id
    );
  });
  tx();
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

// Hard delete — blocked when the product has sales history. Archive instead.
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT id, is_resale, resale_ingredient_id FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const sales = db.prepare('SELECT COUNT(*) c FROM transaction_items WHERE product_id = ?').get(id).c
    + db.prepare('SELECT COUNT(*) c FROM invoice_items WHERE product_id = ?').get(id).c;
  if (sales > 0) return res.status(409).json({ error: `Cannot delete: this product has ${sales} sales record(s). Archive it instead.` });

  db.transaction(() => {
    if (existing.is_resale) deleteResaleIngredient(existing.resale_ingredient_id);
    db.prepare('DELETE FROM recipes WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM product_prices WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  })();
  res.json({ message: 'Product deleted' });
});

// Image upload not wired in the new app yet.
router.post('/:id/image', (_req, res) => res.json({ message: 'Image upload not supported yet' }));

module.exports = router;
