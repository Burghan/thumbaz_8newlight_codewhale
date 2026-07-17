// Maintenance tool: reverse every Riwayat-imported transaction so the source
// .xls can be cleanly re-imported with the CURRENT import logic (discount-aware
// Total-based revenue, all columns captured, cancelled receipts kept live and
// flagged instead of record-then-voided).
//
// Why this is needed: /api/import/riwayat skips any receipt it has already
// imported or that appears in void_log, so simply re-uploading the file does
// NOT correct rows imported by the older, buggy code. They must be reversed
// first — that's what this does.
//
// SAFE BY DEFAULT: with no flag it only takes a backup and prints what it WOULD
// do (dry run). Pass --yes to actually perform the reversal.
//
//   node server/reset-riwayat.js            # dry run (report only)
//   node server/reset-riwayat.js --yes      # perform the reset
//   DB_PATH=/path/backoffice.db node server/reset-riwayat.js --yes   # if the app uses DB_PATH
//
// Preserves manual entries (transactions with no `reference`) — it reports them
// but never deletes them. After this runs, re-import the Riwayat .xls via the
// Import Center (or POST /api/import/riwayat).

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { voidSale } = require('./lib/voidSale');

const CONFIRM = process.argv.includes('--yes');

// Resolve the exact DB file the app uses (mirrors server/db.js), so the backup
// and the operation act on the same file. Printed prominently so you can verify.
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../data/backoffice.db');
console.log('Database file:', dbPath);

const money = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const totals = () => db.prepare(`
  SELECT COUNT(*) n, COALESCE(SUM(x.rev),0) rev FROM (
    SELECT t.id, (SELECT COALESCE(SUM(ti.line_total),0) FROM transaction_items ti
                  WHERE ti.transaction_id = t.id) rev
    FROM transactions t) x`).get();

const before = totals();
const withRef = db.prepare('SELECT COUNT(*) n FROM transactions WHERE reference IS NOT NULL').get().n;
const noRef = db.prepare('SELECT COUNT(*) n FROM transactions WHERE reference IS NULL').get().n;

console.log('');
console.log(`Before: ${before.n} transactions, revenue ${money(before.rev)}`);
console.log(`  Riwayat-imported (reference set): ${withRef}  → will be REVERSED`);
console.log(`  Manual (no reference):            ${noRef}  → will be KEPT`);
console.log('');

if (!CONFIRM) {
  console.log('DRY RUN — nothing changed. Re-run with  --yes  to perform the reset.');
  process.exit(0);
}

// 1. Backup first (checkpoint WAL so the copy is complete), matching the
//    existing data/backoffice.db.backup.<label>.<timestamp> convention.
const d = new Date();
const p = (x) => String(x).padStart(2, '0');
const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const backup = `${dbPath}.backup.pre-riwayat-reset.${ts}`;
db.pragma('wal_checkpoint(FULL)');
fs.copyFileSync(dbPath, backup);
console.log('Backup written:', backup);

// 2. Reverse every reference-bearing (Riwayat-imported) transaction. restock:true
//    returns their ingredients — the re-import re-deducts, so inventory nets out.
//    NOTE: do NOT pass `reference` here — doing so writes it into void_log, which
//    the importer then treats as "already voided" and would refuse to re-import.
const targets = db.prepare('SELECT id FROM transactions WHERE reference IS NOT NULL').all();
const RESET_REASON = 'Reset: re-importing Riwayat with current logic';
const run = db.transaction(() => {
  for (const t of targets) voidSale(t.id, { restock: true, reason: RESET_REASON });
});
run();
console.log(`Reversed ${targets.length} Riwayat-imported transaction(s).`);

// 3. Clear void_log noise so receipts re-import as normal live rows:
//    - this reset's own rows (exact-match on our reason)
//    - the OLD "Cancelled in source POS" auto-void rows created by the previous
//      importer for fully-cancelled receipts (the new code keeps those live).
//    Real manual voids and reconciliation voids are left untouched.
const cleaned = db.prepare(
  "DELETE FROM void_log WHERE reason = ? OR reason LIKE 'Cancelled in source POS%'"
).run(RESET_REASON).changes;
console.log(`Cleaned ${cleaned} void_log row(s).`);

const after = totals();
console.log('');
console.log(`After: ${after.n} transactions, revenue ${money(after.rev)}`);
console.log('');
console.log('Next: re-import the Riwayat .xls via the Import Center (or POST /api/import/riwayat).');
