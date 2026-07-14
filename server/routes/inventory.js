const express = require('express');
const db = require('../db');

const router = express.Router();

// Current stock on hand per ingredient.
router.get('/on-hand', (_req, res) => {
  const rows = db.prepare(`
    SELECT inv.ingredient_id, i.name, i.category, i.base_unit, i.purchase_unit,
           inv.quantity_base, CAST(inv.avg_cost_micro AS REAL)/1e6 AS avg_cost,
           i.min_stock
    FROM inventory inv
    JOIN ingredients i ON i.id = inv.ingredient_id
    WHERE i.active = 1 AND IFNULL(i.category,'') <> '__resale'
    ORDER BY i.name
  `).all();
  res.json(rows);
});

// Items below their minimum stock threshold.
router.get('/thresholds', (_req, res) => {
  const rows = db.prepare(`
    SELECT i.id AS ingredient_id, i.name, i.base_unit,
           inv.quantity_base,
           i.min_stock,
           CASE WHEN inv.quantity_base < i.min_stock THEN 1 ELSE 0 END AS below
    FROM inventory inv
    JOIN ingredients i ON i.id = inv.ingredient_id
    WHERE i.active = 1 AND i.min_stock > 0
    ORDER BY i.name
  `).all();
  res.json(rows);
});

// Inventory summary (totals).
router.get('/summary', (_req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS total_items,
           SUM(inv.quantity_base) AS total_quantity,
           ROUND(SUM(inv.quantity_base * CAST(inv.avg_cost_micro AS REAL)/1e6)) AS total_value
    FROM inventory inv
    JOIN ingredients i ON i.id = inv.ingredient_id
    WHERE i.active = 1
  `).get();
  res.json(row || { total_items: 0, total_quantity: 0, total_value: 0 });
});

// List recent stock movements, filterable by source. Default stays
// manual-only (adjustment/opening) for existing callers (Dashboard's "recent
// activity" spotlight, which would otherwise get drowned out by routine
// per-sale usage rows). Inventory's Recent Movements panel picks a specific
// source per request — filtering server-side (not a shared "recent N of any
// type" window) so e.g. "Purchases" still finds the last purchases even
// though sales vastly outnumber them and would otherwise push purchases out
// of a combined recency window.
const MOVE_TYPE_CLAUSES = {
  all: `sm.type IN ('adjustment', 'opening', 'usage', 'purchase', 'transfer_in', 'transfer_out')`,
  sale: `sm.type = 'usage'`,
  purchase: `sm.type = 'purchase'`,
  manual: `sm.type IN ('adjustment', 'opening', 'transfer_in', 'transfer_out')`,
};
router.get('/adjustments', (req, res) => {
  const typeClause = MOVE_TYPE_CLAUSES[req.query.type] || `sm.type IN ('adjustment', 'opening')`;
  const limit = Math.min(300, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const rows = db.prepare(`
    SELECT sm.id, sm.ingredient_id, i.name AS ingredient_name,
           sm.type, sm.qty_base, sm.unit_cost_micro,
           CAST(sm.unit_cost_micro AS REAL)/1e6 AS unit_cost,
           sm.ref_type, sm.ref_id,
           sm.note, sm.created_at
    FROM stock_movements sm
    JOIN ingredients i ON i.id = sm.ingredient_id
    WHERE ${typeClause}
    ORDER BY sm.created_at DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

// Create an inventory adjustment (positive or negative).
router.post('/adjustments', (req, res) => {
  const b = req.body || {};
  const ingredientId = Number(b.ingredient_id);
  const qtyBase = Number(b.qty_base || 0);
  if (!ingredientId || qtyBase === 0) {
    return res.status(400).json({ error: 'ingredient_id and non-zero qty_base required' });
  }

  const tx = db.transaction(() => {
    const ing = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(ingredientId);
    if (!ing) throw new Error('Ingredient not found');

    // Create stock movement.
    const type = qtyBase > 0 ? 'adjustment' : 'adjustment';
    db.prepare(
      `INSERT INTO stock_movements (ingredient_id, type, qty_base, unit_cost_micro, note)
       VALUES (?, ?, ?, ?, ?)`
    ).run(ingredientId, type, qtyBase, 0, (b.note || '').trim() || null);

    // Update inventory quantity.
    db.prepare(
      `UPDATE inventory SET quantity_base = quantity_base + ?,
         updated_at = datetime('now') WHERE ingredient_id = ?`
    ).run(qtyBase, ingredientId);
  });

  try {
    tx();
    res.json({ message: 'Adjustment recorded' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Bulk update min_stock thresholds.
router.put('/thresholds', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  const stmt = db.prepare('UPDATE ingredients SET min_stock = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const tx = db.transaction(() => {
    items.forEach(item => {
      if (item.ingredient_id && item.min_stock != null) {
        stmt.run(Number(item.min_stock), Number(item.ingredient_id));
      }
    });
  });
  tx();
  res.json({ message: `Updated ${items.length} threshold(s)` });
});

// --- NOT YET IMPLEMENTED (locations/transfers need additional DB tables) ---
router.get('/locations', (_req, res) => res.json([]));
router.get('/location-stock', (_req, res) => res.json({ quantity_base: 0 }));
router.get('/transfers', (_req, res) => res.json([]));
router.post('/transfers', (_req, res) => res.json({ message: 'Transfers coming soon' }));
router.put('/transfers/:id', (_req, res) => res.json({ message: 'Transfers coming soon' }));
router.put('/adjustments/:id', (_req, res) => res.json({ message: 'Adjustment updates coming soon' }));
router.get('/turnover', (_req, res) => res.json([]));

module.exports = router;
