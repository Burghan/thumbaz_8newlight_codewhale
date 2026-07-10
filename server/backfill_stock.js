const db = require('./db');
const { deductStockForSale } = require('./lib/stock');

// Backfill: deduct stock for all existing transactions that don't have usage movements yet
const txns = db.prepare(`
  SELECT t.id FROM transactions t
  WHERE NOT EXISTS (
    SELECT 1 FROM stock_movements sm WHERE sm.ref_type='sale' AND sm.ref_id=t.id
  )
`).all();

console.log(`Backfilling ${txns.length} transactions...`);

let totalDeducted = 0, totalSkipped = 0;

const tx = db.transaction(() => {
  for (const txn of txns) {
    const items = db.prepare(`
      SELECT product_id, quantity FROM transaction_items WHERE transaction_id = ?
    `).all(txn.id);

    if (!items.length) continue;

    // Need product prices for import
    const mapped = items.map(i => ({ product_id: i.product_id, quantity: i.quantity }));
    const result = deductStockForSale(txn.id, mapped);
    totalDeducted += result.deducted;
    totalSkipped += result.skipped;
  }
});

tx();

console.log(`✅ Deducted: ${totalDeducted} stock movements, Skipped: ${totalSkipped} (no recipe)`);

// Verify
const usageCount = db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type='usage'").get();
console.log(`Stock movements (usage): ${usageCount.n}`);
