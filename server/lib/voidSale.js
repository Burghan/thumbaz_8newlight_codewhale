const db = require('../db');

// Reverses a paid sale: restock=true returns ingredients to stock and drops
// their usage movements (order never actually made); restock=false reverses
// the money only and leaves inventory consumed (comp/correction). Either way
// the transaction + items are removed and the void is recorded in void_log.
// Shared by the manual void endpoint (POST /api/sales/:id/void) and the
// riwayat import's reconciliation step (auto-voiding orders that disappeared
// from a re-imported source export).
function voidSale(id, { restock, reason }) {
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
      `INSERT INTO void_log (transaction_id, total, items, reason, restocked)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, total, itemsSummary, reason, restock ? 1 : 0);

    db.prepare('DELETE FROM transaction_items WHERE transaction_id = ?').run(id);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  })();

  return { ok: true, total, itemsSummary };
}

module.exports = { voidSale };
