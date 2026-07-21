const db = require('../db');

// Reverses a paid sale: restock=true returns ingredients to stock and drops
// their usage movements (order never actually made); restock=false reverses
// the money only and leaves inventory consumed (comp/correction). The
// transaction and its items are NOT deleted — each item's quantity/line_total
// are zeroed (so revenue/report sums net them out automatically, same as
// every other SUM-based query already does) and tagged status='Dibatalkan',
// with original_quantity/cancelled_quantity preserved. This is the exact
// convention the Riwayat import already uses for a cancelled receipt (see
// server/routes/import.js) — a live void now produces data indistinguishable
// from an imported cancellation, so Transaction History shows one consistent
// picture instead of live voids just vanishing while imported ones stay
// visible. Also recorded in void_log for the who/why/when audit trail.
// Shared by the manual void endpoint (POST /api/sales/:id/void) and the
// riwayat import's reconciliation step (auto-voiding orders that disappeared
// from a re-imported source export).
function voidSale(id, { restock, reason, reference }) {
  const txn = db.prepare('SELECT id, customer_id, points_earned, redeem_points FROM transactions WHERE id = ?').get(id);
  if (!txn) return { ok: false, error: 'Sale not found' };

  const lines = db.prepare(`
    SELECT ti.id, ti.quantity, ti.line_total, ti.original_quantity, ti.cancelled_quantity, p.name
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

    const cancelLine = db.prepare(
      `UPDATE transaction_items
       SET original_quantity = COALESCE(original_quantity, quantity),
           cancelled_quantity = COALESCE(cancelled_quantity, 0) + quantity,
           quantity = 0,
           line_total = 0,
           status = 'Dibatalkan'
       WHERE id = ?`
    );
    for (const l of lines) cancelLine.run(l.id);
  })();

  return { ok: true, total, itemsSummary };
}

// Voids part of one line item (e.g. rung up 3, cancel 1 — or cancel the whole
// line while the rest of the order stays untouched) — this is "void per menu
// item" / Fix Qty, the same action under one name now. Unlike voidSale, the
// transaction and its other lines are untouched; only this one line's
// quantity/line_total shrink (down to 0 if the whole item is being voided),
// tagged status='Batal Sebagian' with original_quantity/cancelled_quantity
// preserved — same soft-cancel convention as a full void and as the Riwayat
// import's own "Batal Sebagian" rows, so the receipt still shows exactly what
// was cancelled instead of the line silently vanishing. restock=true adds
// back the ingredients for just the removed quantity, recomputed from the
// recipe (stock_movements has no per-line link, so this can't reuse the
// original deduction rows the way a full void does — it must recompute and
// log a fresh compensating entry). Logged to void_log same as a full void.
// Note: does not recompute the transaction's discount_amount or the
// customer's loyalty points_earned — those stay based on the original total,
// since a line-item cancellation is scoped to that item, not the whole sale.
function voidPartialItem(transactionId, { itemId, newQty, reason, restock }) {
  const txn = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transactionId);
  if (!txn) return { ok: false, error: 'Sale not found' };

  const item = db.prepare(`
    SELECT ti.id, ti.product_id, ti.quantity, ti.unit_price, ti.original_quantity, ti.cancelled_quantity, p.name AS product_name
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

    db.prepare(
      `UPDATE transaction_items
       SET original_quantity = COALESCE(original_quantity, quantity),
           cancelled_quantity = COALESCE(cancelled_quantity, 0) + ?,
           quantity = ?,
           line_total = ?,
           status = 'Batal Sebagian'
       WHERE id = ?`
    ).run(removedQty, newQty, newQty * item.unit_price, item.id);

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
