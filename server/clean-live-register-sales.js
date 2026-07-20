// Maintenance tool: void every LIVE-register transaction (reference IS NULL
// — i.e. rung up through the POS, not from a Riwayat import) while leaving
// imported transactions (reference set) untouched.
//
// Real sales data for this shop comes from Riwayat Transaksi imports; the
// live POS register has so far only been used for testing (Bluetooth
// printing, invoice flow, staff-role checks, etc.), so its transactions are
// test noise that shouldn't sit alongside real revenue.
//
// Uses voidSale({ restock: true }) — the same reversal the UI's Void button
// and reset-riwayat.js use — so ingredients these test sales deducted are
// returned to stock and any loyalty points they earned/redeemed on a real
// customer are reversed too. NOTE: does not pass `reference` to voidSale
// (writing one into void_log would be misleading here — these never had a
// source reference to begin with).
//
// SAFE BY DEFAULT: with no flag it only takes a backup and reports what it
// WOULD void (dry run). Pass --yes to actually perform it.
//
//   node server/clean-live-register-sales.js            # dry run (report only)
//   node server/clean-live-register-sales.js --yes       # perform the cleanup
//   DB_PATH=/path/backoffice.db node server/clean-live-register-sales.js --yes

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { voidSale } = require('./lib/voidSale');

const CONFIRM = process.argv.includes('--yes');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../data/backoffice.db');
console.log('Database file:', dbPath);

const money = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

const targets = db.prepare(`
  SELECT t.id, t.transacted_at, COALESCE(SUM(ti.line_total), 0) AS total
  FROM transactions t
  LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
  WHERE t.reference IS NULL
  GROUP BY t.id
  ORDER BY t.id
`).all();

const importedCount = db.prepare('SELECT COUNT(*) n FROM transactions WHERE reference IS NOT NULL').get().n;
const targetRevenue = targets.reduce((s, t) => s + t.total, 0);

console.log('');
console.log(`Live-register transactions (no reference): ${targets.length}  → will be VOIDED (restocked + loyalty reversed)`);
console.log(`Riwayat-imported transactions:              ${importedCount}  → will be KEPT`);
console.log(`Revenue being removed:                      ${money(targetRevenue)}`);
if (targets.length) {
  console.log('');
  console.log('First few:', targets.slice(0, 5).map(t => `#${t.id} ${t.transacted_at} ${money(t.total)}`).join(', '));
  if (targets.length > 5) console.log(`...and ${targets.length - 5} more.`);
}
console.log('');

if (!CONFIRM) {
  console.log('DRY RUN — nothing changed. Re-run with  --yes  to perform the cleanup.');
  process.exit(0);
}

if (!targets.length) {
  console.log('Nothing to clean up.');
  process.exit(0);
}

// Backup first, matching the existing data/backoffice.db.backup.<label>.<timestamp> convention.
const d = new Date();
const p = (x) => String(x).padStart(2, '0');
const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const backup = `${dbPath}.backup.pre-live-register-clean.${ts}`;
db.pragma('wal_checkpoint(FULL)');
fs.copyFileSync(dbPath, backup);
console.log('Backup written:', backup);

const REASON = 'Cleanup: test sale via live register (not a real order)';
let ok = 0, failed = 0;
const run = db.transaction(() => {
  for (const t of targets) {
    const result = voidSale(t.id, { restock: true, reason: REASON });
    if (result.ok) ok++; else { failed++; console.log(`  #${t.id} failed: ${result.error}`); }
  }
});
run();
console.log(`Voided ${ok} live-register transaction(s)${failed ? `, ${failed} failed` : ''}.`);
