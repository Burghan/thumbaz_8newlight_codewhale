const db = require('./db');
const rows = require('/tmp/riwayat_raw.json');
const header = rows[0];
const data = rows.slice(1);

function idx(name) { return header.findIndex(h => String(h).includes(name)); }

const colNo = idx('Struk'), colDate = idx('Tanggal'), colProduct = idx('Produk');
const colQty = idx('Jumlah'), colPrice = idx('Harga'), colPayment = idx('Metode');
const colStatus = idx('Status');

const prodMap = new Map();
db.prepare('SELECT id, name, variant FROM products').all().forEach(p => {
  prodMap.set(p.name.toLowerCase(), p);
  if (p.variant) {
    prodMap.set(`${p.name.toLowerCase()}, ${p.variant.toLowerCase()}`, p);
    prodMap.set(`${p.name.toLowerCase()} - ${p.variant.toLowerCase()}`, p);
  }
});

const txns = new Map();
for (const r of data) {
  const status = String(r[colStatus]||'').trim();
  if (status === 'Dibatalkan') continue;
  const no = String(r[colNo]||'').trim();
  const date = String(r[colDate]||'').trim();
  const product = String(r[colProduct]||'').trim().toLowerCase();
  const qty = Number(r[colQty]||1);
  const price = Number(r[colPrice]||0);
  const payment = String(r[colPayment]||'CASH').trim();
  const parts = date.split('-');
  const dateStr = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : date;
  const key = `${no}-${dateStr}`;
  if (!txns.has(key)) txns.set(key, { date: dateStr, payment: payment.toLowerCase().includes('qris') ? 'qris' : 'cash', items: [] });
  txns.get(key).items.push({ product, qty, price });
}

console.log(`Transactions: ${txns.size}`);

const insTxn = db.prepare("INSERT INTO transactions (transacted_at, payment_method, reference) VALUES (?,?,?)");
const insItem = db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)");

let imported = 0, skipped = 0;
const unmatched = new Set();

const tx = db.transaction(() => {
  for (const [no, txn] of txns) {
    const txnR = insTxn.run(txn.date, txn.payment, no);
    for (const item of txn.items) {
      let prod = prodMap.get(item.product);
      if (!prod) {
        for (const [k, p] of prodMap) {
          if (k.includes(item.product) || item.product.includes(k)) { prod = p; break; }
        }
      }
      if (!prod) { unmatched.add(item.product); skipped++; continue; }
      insItem.run(txnR.lastInsertRowid, prod.id, item.qty, Math.round(item.price), Math.round(item.qty * item.price));
      imported++;
    }
  }
});

try { tx(); } catch(e) { console.error('Error:', e.message); return; }

console.log(`Imported: ${imported}, Skipped: ${skipped}`);
if (unmatched.size) console.log(`Unmatched: ${[...unmatched].join(', ')}`);
const rev = db.prepare('SELECT SUM(line_total) AS r FROM transaction_items').get();
console.log(`DB revenue: Rp ${(rev.r||0).toLocaleString('id-ID')}`);
