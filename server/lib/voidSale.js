const db = require('../db');

// Reverses a paid sale: restock=true returns ingredients to stock and drops
// their usage movements (order never actually made); restock=false reverses
// the money only and leaves inventory consumed (comp/correction). Either way
// the transaction + items are removed and the void is recorded in void_log.
// Shared by the manual void endpoint (POST /api/sales/:id/void) and the
// riwayat import's reconciliation step (auto-voiding orders that disappeared
// from a re-imported source export).
function voidSale(id, { restock, reason, reference }) {
  const txn = db.prepare('SELECT id, customer_id, points_earned, redeem_points FROM transactions WHERE id = ?').get(id);
  if (!txn) return { ok: false, error: 'Sale not found' };

  const lines = db.prepare(`
    SELECT ti.quantity, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id = ti.product_id
    WHERE ti.transaction_id = ?`).all(id);
  const total = lines.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
  const itemsSummary = lines.map((l) => `${l.quantity}× ${l.name}`).join(', ');

  db.transaction(() => {
    if (restock) {
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
    }

    if (txn.customer_id && (txn.points_earned > 0 || txn.redeem_points > 0)) {
      db.prepare(
        `UPDATE customers
         SET points_balance = MAX(0, points_balance - ? + ?), updated_at = datetime('now')
         WHERE id = ?`
      ).run(txn.points_earned || 0, txn.redeem_points || 0, txn.customer_id);
    }

    db.prepare(
      `INSERT INTO void_log (transaction_id, total, items, reason, restocked, reference)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, total, itemsSummary, reason, restock ? 1 : 0, reference || null);

    db.prepare('DELETE FROM transaction_items WHERE transaction_id = ?').run(id);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  })();

  return { ok: true, total, itemsSummary };
}

// Corrects one line item's quantity downward (e.g. rung up 2, should've been
// 1) without touching the rest of the transaction. Unlike voidSale, the
// transaction and its other lines stay exactly as they are — only this one
// line's quantity/total shrinks (or the line is dropped entirely if the
// corrected quantity is 0). restock=true adds back the ingredients for just
// the removed quantity, recomputed from the recipe (stock_movements has no
// per-line link, so this can't reuse the original deduction rows the way a
// full void does — it must recompute and log a fresh compensating entry).
// Logged to void_log same as a full void, so partial corrections show up in
// the same audit trail, tagged distinctly in the reason.
// Note: does not recompute the transaction's discount_amount or the
// customer's loyalty points_earned — those stay based on the original total,
// since a small quantity correction is a data-entry fix, not a cancellation.
function voidPartialItem(transactionId, { itemId, newQty, reason, restock }) {
  const txn = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transactionId);
  if (!txn) return { ok: false, error: 'Sale not found' };

  const item = db.prepare(`
    SELECT ti.id, ti.product_id, ti.quantity, ti.unit_price, p.name AS product_name
    FROM transaction_items ti JOIN products p ON p.id = ti.product_id
    WHERE ti.id = ? AND ti.transaction_id = ?`).get(itemId, transactionId);
  if (!item) return { ok: false, error: 'Line item not found on this order' };

  if (!Number.isInteger(newQty) || newQty < 0) return { ok: false, error: 'Corrected quantity must be 0 or more' };
  if (newQty >= item.quantity) return { ok: false, error: `Corrected quantity must be less than the current quantity (${item.quantity})` };

  const removedQty = item.quantity - newQty;
  const removedTotal = removedQty * item.unit_price;

  db.transaction(() => {
    if (restock) {
      const recipeLines = db.prepare(`
        SELECT ingredient_id, quantity AS recipe_qty FROM recipes WHERE product_id = ?`
      ).all(item.product_id);
      const bump = db.prepare(
        `UPDATE inventory SET quantity_base = quantity_base + ?, updated_at = datetime('now')
         WHERE ingredient_id = ?`
      );
      const addMovement = db.prepare(`
        INSERT INTO stock_movements (ingredient_id, type, qty_base, ref_type, ref_id, note)
        VALUES (?, 'adjustment', ?, 'sale', ?, ?)
      `);
      for (const r of recipeLines) {
        const amount = r.recipe_qty * removedQty;
        bump.run(amount, r.ingredient_id);
        addMovement.run(
          r.ingredient_id, amount, transactionId,
          `Qty correction on sale #${transactionId}: +${amount} returned (${item.product_name} ${item.quantity}→${newQty})`
        );
      }
    }

    if (newQty === 0) {
      db.prepare('DELETE FROM transaction_items WHERE id = ?').run(item.id);
    } else {
      db.prepare('UPDATE transaction_items SET quantity = ?, line_total = ? WHERE id = ?')
        .run(newQty, newQty * item.unit_price, item.id);
    }

    db.prepare(
      `INSERT INTO void_log (transaction_id, total, items, reason, restocked)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      transactionId, removedTotal,
      `${removedQty}× ${item.product_name} (qty corrected ${item.quantity}→${newQty})`,
      reason, restock ? 1 : 0
    );
  })();

  return { ok: true, removedQty, removedTotal };
}

module.exports = { voidSale, voidPartialItem };
