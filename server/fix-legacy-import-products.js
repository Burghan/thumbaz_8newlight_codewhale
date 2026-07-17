// One-time cleanup for products the OLD Riwayat importer mishandled, so a fresh
// re-import (with the corrected matcher) maps cleanly:
//   - reactivates the real "Paket Geprek" that had been left inactive (the old
//     importer couldn't see it and made a Custom duplicate instead);
//   - deletes the junk Custom products the old importer auto-created for names
//     the matcher now resolves ("air", "es", "aires", "NewLight Latte, Extra
//     Shot", "Paket Geprek") — but ONLY when they carry no sales, so nothing
//     real is ever removed.
//
// Idempotent and keyed by name/category (not hard-coded ids), so it is safe to
// run on any copy (local or droplet) and safe to run more than once. Intended to
// run AFTER reset-riwayat.js and BEFORE the re-import.
//
//   node server/fix-legacy-import-products.js            # dry run (report only)
//   node server/fix-legacy-import-products.js --yes      # apply

const db = require('./db');

const CONFIRM = process.argv.includes('--yes');

// Names the corrected matcher now resolves to real products, so any Custom
// product with one of these names is leftover junk from the old importer.
const JUNK_NAMES = ['air', 'es', 'aires', 'newlight latte, extra shot', 'paket geprek'];

const reactivateTargets = db.prepare(
  "SELECT id, name FROM products WHERE LOWER(name) = 'paket geprek' AND category <> 'Custom' AND active = 0"
).all();

const placeholders = JUNK_NAMES.map(() => '?').join(',');
const junk = db.prepare(
  `SELECT p.id, p.name,
          (SELECT COUNT(*) FROM transaction_items ti WHERE ti.product_id = p.id) AS sales
   FROM products p
   WHERE p.category = 'Custom' AND LOWER(p.name) IN (${placeholders})`
).all(...JUNK_NAMES);

const deletable = junk.filter(j => j.sales === 0);
const kept = junk.filter(j => j.sales > 0);

console.log('Reactivate (real Paket Geprek left inactive):');
reactivateTargets.forEach(r => console.log(`  [${r.id}] ${r.name}`));
if (!reactivateTargets.length) console.log('  (none — already active or absent)');

console.log('Delete (junk Custom products with no sales):');
deletable.forEach(j => console.log(`  [${j.id}] ${j.name}`));
if (!deletable.length) console.log('  (none)');

if (kept.length) {
  console.log('Skipped (Custom products that still have sales — left untouched):');
  kept.forEach(j => console.log(`  [${j.id}] ${j.name} — ${j.sales} line-item(s)`));
}

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing changed. Re-run with  --yes  to apply.');
  process.exit(0);
}

const apply = db.transaction(() => {
  for (const r of reactivateTargets) {
    db.prepare("UPDATE products SET active = 1, updated_at = datetime('now') WHERE id = ?").run(r.id);
  }
  for (const j of deletable) {
    db.prepare('DELETE FROM product_prices WHERE product_id = ?').run(j.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(j.id);
  }
});
apply();

console.log(`\nDone: reactivated ${reactivateTargets.length}, deleted ${deletable.length} junk product(s).`);
