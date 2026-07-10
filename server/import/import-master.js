const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const db = require('../db');

// Column mapping helper
function headerMap(ws) {
  const row = ws.getRow(1);
  const map = {};
  row.eachCell((cell, col) => {
    if (cell.value) map[normName(cell.value)] = col;
  });
  return map;
}

function normName(v) {
  if (v == null) return '';
  if (typeof v === 'number') v = String(v);
  if (v instanceof Date) v = v.toISOString().slice(0, 10);
  return String(v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}

async function main() {
  const fname = process.argv[2] || 'data/JUNI_NEWLIGHT_SYSTEM_REPORT.xlsx';
  const filePath = path.resolve(fname);
  const apply = process.argv.includes('--apply');

  console.log(`📂 Reading: ${filePath}`);
  if (!fs.existsSync(filePath)) { console.error('File not found:', filePath); process.exit(1); }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  console.log('Sheets:', wb.worksheets.map(s => s.name).join(', '));

  // 1. Import Sales Detail
  let salesWs = wb.getWorksheet('Sales Detail') || wb.getWorksheet('Daily Sales');
  if (salesWs) {
    const hdr = headerMap(salesWs);
    console.log('\n📊 Sales Detail columns:', Object.keys(hdr).join(', '));

    const dateCol = hdr.tanggal || hdr.date;
    const nameCol = hdr.product || hdr.produk || hdr.nama || hdr.menu;
    const qtyCol = hdr.quantity || hdr.jumlah || hdr.qty;
    const priceCol = hdr.price || hdr.harga;

    if (dateCol && nameCol) {
      // Build product map
      const prodMap = new Map();
      db.prepare('SELECT id, name FROM products WHERE active=1').all().forEach(p => {
        prodMap.set(normName(p.name), p);
        // Also store with variant patterns
        prodMap.set(normName(p.name).replace(/\s*-\s*/g, ', '), p);
      });

      let imported = 0, skipped = 0;
      const unmatched = new Set();

      if (apply) {
        const insTxn = db.prepare("INSERT INTO transactions (transacted_at, payment_method) VALUES (?,'cash')");
        const insItem = db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)");

        db.transaction(() => {
          salesWs.eachRow((row, i) => {
            if (i === 1) return; // skip header
            const dateRaw = row.getCell(dateCol).value;
            const nameRaw = row.getCell(nameCol).value;
            if (!dateRaw || !nameRaw) return;

            let dateStr = typeof dateRaw === 'number' ? String(dateRaw) : (dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw).trim());
            const nameKey = normName(nameRaw);
            const product = prodMap.get(nameKey);

            if (!product) { unmatched.add(normName(nameRaw)); skipped++; return; }

            const qty = qtyCol ? (Number(row.getCell(qtyCol).value) || 1) : 1;
            const price = priceCol ? Math.round(Number(row.getCell(priceCol).value) || 0) : 0;

            const txn = insTxn.run(dateStr);
            insItem.run(txn.lastInsertRowid, product.id, qty, price, qty * price);
            imported++;
          });
        })();
        console.log(`  ✅ Imported ${imported} sales records, ${skipped} skipped`);
        if (unmatched.size) console.log(`  ⚠ Unmatched products: ${[...unmatched].join(', ')}`);
      } else {
        // Dry run
        let count = 0;
        salesWs.eachRow((row, i) => { if (i > 1 && row.getCell(dateCol).value && row.getCell(nameCol).value) count++; });
        console.log(`  🔍 Dry run: ${count} rows found`);
      }
    }
  }

  // 2. Import Ingredients
  let ingWs = wb.getWorksheet('Ingredients');
  if (ingWs) {
    const hdr = headerMap(ingWs);
    console.log('\n🧪 Ingredients columns:', Object.keys(hdr).join(', '));

    const nameCol = hdr.name || hdr.nama || hdr.ingredient || hdr['nama bahan baku'] || hdr['ingredient name'];
    const priceCol = hdr.last_purchase_price || hdr['harga beli terakhir (rp)'] || hdr.price || hdr.harga;
    const costCol = hdr.std_cost_per_base || hdr.cost || hdr['hpp per unit'];

    if (nameCol) {
      const ingMap = new Map();
      db.prepare('SELECT id, name FROM ingredients WHERE active=1').all().forEach(i => {
        ingMap.set(normName(i.name), i);
      });

      if (apply) {
        let updated = 0;
        db.transaction(() => {
          ingWs.eachRow((row, i) => {
            if (i === 1) return;
            const nameRaw = row.getCell(nameCol).value;
            if (!nameRaw) return;
            const ing = ingMap.get(normName(nameRaw));
            if (!ing) return;

            if (priceCol) {
              const price = Math.round(Number(row.getCell(priceCol).value) || 0);
              if (price > 0) db.prepare("UPDATE ingredients SET last_purchase_price = ?, updated_at = datetime('now') WHERE id = ?").run(price, ing.id);
            }
            if (costCol) {
              const cost = Number(row.getCell(costCol).value) || 0;
              if (cost > 0) db.prepare("UPDATE ingredients SET std_cost_per_base_micro = ?, updated_at = datetime('now') WHERE id = ?").run(Math.round(cost * 1e6), ing.id);
            }
            updated++;
          });
        })();
        console.log(`  ✅ Updated ${updated} ingredients`);
      } else {
        let count = 0;
        ingWs.eachRow((row, i) => { if (i > 1 && row.getCell(nameCol).value) count++; });
        console.log(`  🔍 Dry run: ${count} ingredient rows found`);
      }
    }
  }

  // 3. Import Recipes (Menu sheet)
  let menuWs = wb.getWorksheet('Menu') || wb.getWorksheet('Recipes') || wb.getWorksheet('Recipe');
  if (menuWs) {
    const hdr = headerMap(menuWs);
    console.log('\n📋 Menu/Recipe columns:', Object.keys(hdr).join(', '));
    
    const prodCol = hdr.product || hdr.menu || hdr.nama || hdr['nama produk'] || hdr['menu item'];
    const ingCol = hdr.ingredient || hdr.bahan || hdr['nama bahan'] || hdr['bahan baku'];
    const qtyCol = hdr.quantity || hdr.qty || hdr.jumlah || hdr['qty'];

    if (prodCol && ingCol && apply) {
      const prodMap = new Map();
      db.prepare('SELECT id, name FROM products WHERE active=1').all().forEach(p => prodMap.set(normName(p.name), p));
      const ingMap = new Map();
      db.prepare('SELECT id, name FROM ingredients WHERE active=1').all().forEach(i => ingMap.set(normName(i.name), i));

      const upsert = db.prepare('INSERT OR REPLACE INTO recipes (product_id, ingredient_id, quantity) VALUES (?,?,?)');
      let imported = 0, skipped = 0;

      db.transaction(() => {
        menuWs.eachRow((row, i) => {
          if (i === 1) return;
          const prod = prodMap.get(normName(row.getCell(prodCol).value));
          const ing = ingMap.get(normName(row.getCell(ingCol).value));
          if (!prod || !ing) { skipped++; return; }
          const qty = qtyCol ? (Number(row.getCell(qtyCol).value) || 0) : 1;
          upsert.run(prod.id, ing.id, qty);
          imported++;
        });
      })();
      console.log(`  ✅ Imported ${imported} recipe lines, ${skipped} skipped`);
    } else if (prodCol && ingCol) {
      let count = 0;
      menuWs.eachRow((row, i) => { if (i > 1 && row.getCell(prodCol).value) count++; });
      console.log(`  🔍 Dry run: ${count} recipe rows found`);
    }
  }

  if (!apply) console.log('\n💡 Run with --apply to execute the import');
}

main().catch(e => {
  console.error('❌ Import failed:', e.message);
  process.exit(1);
});
