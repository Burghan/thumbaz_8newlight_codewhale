const express = require('express');
const db = require('../db');

const router = express.Router();

// List purchases with their line items and ingredient/supplier names.
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.purchased_at AS date, p.reference, p.notes,
           COALESCE(pi.ingredient_id, 0) AS ingredient_id,
           i.name AS ingredient_name,
           pi.purchase_qty AS quantity,
           pi.line_total AS total_cost,
           pi.purchase_unit,
           s.name AS supplier_name
    FROM purchases p
    LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
    LEFT JOIN ingredients i ON i.id = pi.ingredient_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.purchased_at DESC, p.id DESC
  `).all();

  // Merge line items into their parent purchase (one purchase = one row in this simple UI).
  const result = rows.map(r => ({
    id: r.id,
    date: r.date || '',
    category: r.ingredient_id ? 'ingredient' : 'other',
    ingredient_name: r.ingredient_name,
    item_name: r.ingredient_name || r.reference,
    quantity: r.quantity,
    purchase_unit: r.purchase_unit || '',
    total_cost: r.total_cost || 0,
    notes: r.notes || '',
    supplier_name: r.supplier_name || ''
  }));
  res.json(result);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const ingredientId = Number(b.ingredient_id);
  const quantity = Number(b.quantity || 0);
  const totalCost = Math.round(Number(b.total_cost || 0));

  if (!ingredientId || !(quantity > 0)) {
    return res.status(400).json({ error: 'Ingredient and quantity required' });
  }

  // Look up the ingredient to get conversion info.
  const ing = db.prepare('SELECT id, name, base_unit, purchase_unit, conv_purchase_to_base FROM ingredients WHERE id = ?').get(ingredientId);
  if (!ing) return res.status(404).json({ error: 'Ingredient not found' });

  const conv = Number(ing.conv_purchase_to_base) > 0 ? Number(ing.conv_purchase_to_base) : 1;
  const baseQty = quantity * conv;
  const unitPrice = quantity > 0 ? Math.round(totalCost / quantity) : 0;
  const costPerBaseMicro = baseQty > 0 ? Math.round((totalCost / baseQty) * 1e6) : 0;

  const tx = db.transaction(() => {
    // Create purchase header.
    const pinfo = db.prepare(
      // WIB (UTC+7) wall-clock time — see server/lib/time.js.
      `INSERT INTO purchases (supplier_id, purchased_at, reference, notes)
       VALUES (?, datetime('now', '+7 hours'), ?, ?)`
    ).run(b.supplier_id || null, b.reference || null, (b.notes || '').trim() || null);
    const purchaseId = pinfo.lastInsertRowid;

    // Create line item.
    db.prepare(
      `INSERT INTO purchase_items (purchase_id, ingredient_id, purchase_qty, purchase_unit, base_qty, unit_price, line_total)
       VALUES (?,?,?,?,?,?,?)`
    ).run(purchaseId, ingredientId, quantity, ing.purchase_unit || ing.base_unit, baseQty, unitPrice, totalCost);

    // Update inventory (moving average).
    const inv = db.prepare('SELECT quantity_base, avg_cost_micro FROM inventory WHERE ingredient_id = ?').get(ingredientId);
    const oldQty = inv ? inv.quantity_base : 0;
    const oldAvgMicro = inv ? inv.avg_cost_micro : 0;
    const newQty = oldQty + baseQty;
    const newAvgMicro = newQty > 0
      ? Math.round(((oldQty * oldAvgMicro) + (baseQty * costPerBaseMicro)) / newQty)
      : costPerBaseMicro;

    db.prepare(
      `INSERT INTO inventory (ingredient_id, quantity_base, avg_cost_micro) VALUES (?,?,?)
       ON CONFLICT(ingredient_id) DO UPDATE SET quantity_base = ?, avg_cost_micro = ?, updated_at = datetime('now')`
    ).run(ingredientId, newQty, newAvgMicro, newQty, newAvgMicro);

    // Record stock movement. created_at set explicitly (WIB) — the column's
    // own DEFAULT is bare datetime('now'), i.e. UTC, which would show this
    // movement 7 hours behind the purchase it belongs to everywhere else.
    db.prepare(
      `INSERT INTO stock_movements (ingredient_id, type, qty_base, unit_cost_micro, ref_type, ref_id, note, created_at)
       VALUES (?, 'purchase', ?, ?, 'purchase', ?, ?, datetime('now', '+7 hours'))`
    ).run(ingredientId, baseQty, costPerBaseMicro, purchaseId, `Purchase #${purchaseId}: +${quantity} ${ing.purchase_unit || ing.base_unit}`);

    // Update ingredient's last_purchase_price for the latest-price COGS model.
    if (unitPrice > 0) {
      db.prepare(
        `UPDATE ingredients SET last_purchase_price = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(unitPrice, ingredientId);
    }

    return purchaseId;
  });

  const purchaseId = tx();
  res.json({ message: 'Purchase recorded', id: purchaseId });
});

module.exports = router;
