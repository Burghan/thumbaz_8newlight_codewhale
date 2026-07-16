const express = require('express');
const db = require('../db');
const { deductStockForSale, deductIngredientsForSale } = require('../lib/stock');
const router = express.Router();

// Resolve the price_delta (whole rupiah) for one modifier entry attached to a
// cart line. Entries come in two shapes from pos.html:
//   { id, price_delta? }                         → a saved modifier (table lookup)
//   { custom_name, price_delta, ... }            → a one-off custom add-on
// A client-supplied price_delta always wins so overrides/customs are honoured;
// otherwise we trust the modifiers table so a stale/absent client price can't
// under-charge. Unknown ids contribute 0.
function modifierDelta(entry, getModPrice) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.price_delta !== undefined && entry.price_delta !== null && Number.isFinite(Number(entry.price_delta))) {
    return Math.round(Number(entry.price_delta));
  }
  if (entry.id !== undefined && entry.id !== null) {
    const row = getModPrice.get(Number(entry.id));
    return row ? Math.round(Number(row.price_delta) || 0) : 0;
  }
  return 0;
}

// POST /api/sales — adapter for coffee-pos format → our transactions table.
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items' });

  const paymentMap = { cash: 'cash', qris: 'qris', transfer: 'transfer', card: 'transfer' };
  const payment = paymentMap[b.payment_type] || 'cash';

  const getModPrice = db.prepare('SELECT price_delta FROM modifiers WHERE id = ?');
  // A modifier may link to a menu product (Option A); selling the modifier then
  // deducts that product's recipe from inventory.
  const getModProduct = db.prepare('SELECT product_id FROM modifiers WHERE id = ?');

  const tx = db.transaction(() => {
    const txn = db.prepare(
      `INSERT INTO transactions (transacted_at, payment_method, notes)
       VALUES (date('now'), ?, ?)`
    ).run(payment, `${b.order_type||'dinein'}${b.discount_amount>0?` discount:${b.discount_amount}`:''}`);

    const txnId = txn.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale)
       VALUES (?,?,?,?,?,0)`
    );

    for (const item of items) {
      const qty = Number(item.quantity || 1);
      const base = Math.round(Number(item.price || 0));
      // Fold each attached modifier's price into the recorded unit price so the
      // stored line_total matches what the customer was actually charged
      // (previously modifiers were shown in the cart but lost at checkout).
      const modSum = (Array.isArray(item.modifiers) ? item.modifiers : [])
        .reduce((sum, m) => sum + modifierDelta(m, getModPrice), 0);
      const effective = base + modSum;
      insItem.run(txnId, item.product_id, qty, effective, qty * effective);
    }
    return txnId;
  });

  const txnId = tx();
  // Deduct stock for recipe ingredients
  deductStockForSale(txnId, items.map(item => ({ product_id: item.product_id, quantity: item.quantity || 1 })));
  // Also deduct the recipe of any product-linked modifier attached to a line
  // (Option A), scaled by that line's quantity. Logged as the same 'usage'
  // movements tagged to this sale, so Void reverses them and COGS counts them.
  const modProductItems = [];
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    for (const m of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
      if (m && m.id !== undefined && m.id !== null) {
        const row = getModProduct.get(Number(m.id));
        if (row && row.product_id) {
          modProductItems.push({ product_id: row.product_id, quantity: qty });
        }
      }
    }
  }
  if (modProductItems.length) deductStockForSale(txnId, modProductItems);
  // Ad-hoc ingredient lines attached to a line (Phase 2): custom-item on-the-fly
  // recipes and quick ingredient add-ons. Scale each by the line's quantity.
  const extraIngredients = [];
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    for (const ing of (Array.isArray(item.extra_ingredients) ? item.extra_ingredients : [])) {
      const ingredientId = Number(ing && ing.ingredient_id);
      const perUnit = Number(ing && ing.qty_base);
      if (Number.isInteger(ingredientId) && perUnit > 0) {
        extraIngredients.push({ ingredient_id: ingredientId, qty_base: perUnit * qty });
      }
    }
  }
  if (extraIngredients.length) deductIngredientsForSale(txnId, extraIngredients);
  // Lookup transaction with items to return in POS format
  const txn = db.prepare('SELECT id, transacted_at, payment_method FROM transactions WHERE id=?').get(txnId);
  const txnItems = db.prepare(`
    SELECT ti.product_id, ti.quantity, ti.unit_price, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transaction_id=?`).all(txnId);

  res.json({
    success: true,
    sale_id: txn.id,
    message: 'Sale completed',
    sale: {
      id: txn.id,
      created_at: txn.transacted_at,
      payment_type: txn.payment_method,
      items: txnItems.map(i => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, price: i.unit_price, total: i.line_total }))
    }
  });
});

// POST /api/sales/:id/void — reverse a sale: restore the inventory it deducted
// and remove the transaction so it no longer counts toward revenue.
router.post('/:id/void', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid sale id' });

  const txn = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id);
  if (!txn) return res.status(404).json({ error: 'Sale not found' });

  const voidTx = db.transaction(() => {
    // Usage movements record qty_base as negative (what was deducted). Add it
    // back by subtracting that negative amount from current stock.
    const movements = db.prepare(
      `SELECT ingredient_id, qty_base FROM stock_movements
       WHERE ref_type = 'sale' AND ref_id = ? AND type = 'usage'`
    ).all(id);
    const bump = db.prepare(
      `UPDATE inventory SET quantity_base = quantity_base - ?, updated_at = datetime('now')
       WHERE ingredient_id = ?`
    );
    for (const m of movements) {
      bump.run(Number(m.qty_base) || 0, m.ingredient_id);
    }
    db.prepare('DELETE FROM stock_movements WHERE ref_type = ? AND ref_id = ?').run('sale', id);
    db.prepare('DELETE FROM transaction_items WHERE transaction_id = ?').run(id);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  });

  voidTx();
  res.json({ success: true, message: 'Sale voided' });
});

// GET /api/sales — recent sales (for POS display).
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.transacted_at, t.payment_method,
           SUM(ti.line_total) AS total
    FROM transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE t.transacted_at = date('now')
    GROUP BY t.id ORDER BY t.id DESC LIMIT 20
  `).all();
  res.json(rows);
});

module.exports = router;
