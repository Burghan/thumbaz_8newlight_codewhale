const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { cellValue, normName } = require('../lib/xlsx');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Build a header-index map from row 1 of a worksheet.
function headerMap(ws) {
  const map = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = normName(cellValue(cell));
    if (key) map[key] = col;
  });
  return map;
}

const intOf = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

// POST /api/import/menu — upload the Products sheet to bulk-upsert menu items by name (+variant).
router.post('/menu', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let wb;
  try {
    wb = await new ExcelJS.Workbook().xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'Could not read the Excel file' });
  }

  const ws = wb.getWorksheet('Products') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'No sheet found' });

  const h = headerMap(ws);
  if (h.name == null) return res.status(400).json({ error: 'Missing a "Name" column' });

  const get = (row, key) => (h[key] != null ? cellValue(row.getCell(h[key])) : undefined);

  const findByName = db.prepare("SELECT id FROM products WHERE LOWER(name) = ? AND IFNULL(LOWER(variant), '') = ?");
  const insert = db.prepare(`INSERT INTO products (name, category, variant, labor_cost, utility_cost, packaging_cost, notes, active)
    VALUES (?,?,?,?,?,?,?,1)`);
  const update = db.prepare(`UPDATE products SET category = ?, variant = ?, labor_cost = ?, utility_cost = ?,
    packaging_cost = ?, notes = ?, active = 1, updated_at = datetime('now') WHERE id = ?`);
  const closePrice = db.prepare("UPDATE product_prices SET effective_to = datetime('now') WHERE product_id = ? AND effective_to IS NULL");
  const curPrice = db.prepare('SELECT price FROM product_prices WHERE product_id = ? AND effective_to IS NULL ORDER BY id DESC LIMIT 1');
  const addPrice = db.prepare('INSERT INTO product_prices (product_id, price) VALUES (?, ?)');

  function setPrice(id, price) {
    const p = intOf(price);
    if (!(p > 0)) return;
    const cur = curPrice.get(id);
    if (!cur || cur.price !== p) { closePrice.run(id); addPrice.run(id, p); }
  }

  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  const run = db.transaction(() => {
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const name = String(get(row, 'name') || '').trim();
      if (!name) { skipped++; return; }
      const variant = String(get(row, 'variant') || '').trim();
      const category = String(get(row, 'category') || '').trim() || null;
      const labor = intOf(get(row, 'labor'));
      const utility = intOf(get(row, 'utility'));
      const wifi = intOf(get(row, 'wifi'));
      const notes = String(get(row, 'notes') || '').trim() || null;
      const price = get(row, 'selling price');

      const existing = findByName.get(name.toLowerCase(), variant.toLowerCase());
      if (existing) {
        update.run(category, variant || null, labor, utility, wifi, notes, existing.id);
        setPrice(existing.id, price);
        updated++;
      } else {
        const info = insert.run(name, category, variant || null, labor, utility, wifi, notes);
        setPrice(info.lastInsertRowid, price);
        created++;
      }
    });
  });

  try {
    run();
  } catch (e) {
    return res.status(500).json({ error: 'Import failed: ' + e.message });
  }

  res.json({ message: `Imported: ${created} added, ${updated} updated, ${skipped} skipped`, created, updated, skipped, errors });

});

// POST /api/import/sales — import sales/transactions from XLSX.
router.post('/sales', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    // Find a sheet that looks like sales data (has "tanggal" or "date" column)
    let ws = wb.getWorksheet('Daily Sales') || wb.getWorksheet('DailySales');
    if (!ws) {
      for (const s of wb.worksheets) {
        const hdr = headerMap(s);
        if (hdr.tanggal || hdr.date) { ws = s; break; }
      }
    }
    if (!ws) return res.status(400).json({ error: 'No sales sheet found. Expected columns: Tanggal/Date, Product/Nama, Quantity/Jumlah, Price/Harga' });

    const hdr = headerMap(ws);
    const dateCol = hdr.tanggal || hdr.date;
    const nameCol = hdr.product || hdr.produk || hdr.nama || hdr.menu || hdr.item;
    const qtyCol = hdr.quantity || hdr.jumlah || hdr.qty;
    const priceCol = hdr.price || hdr.harga || hdr.unit_price || hdr.total;

    if (!dateCol || !nameCol) return res.status(400).json({ error: 'Missing required columns: Date + Product name' });

    // Pre-load product map
    const prodMap = new Map();
    db.prepare('SELECT id, name FROM products WHERE active=1').all().forEach(p => prodMap.set(normName(p.name), p));

    const insTxn = db.prepare("INSERT INTO transactions (transacted_at, payment_method) VALUES (?,'cash')");
    const insItem = db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)");

    let imported = 0, skipped = 0;
    const tx = db.transaction(() => {
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const dateRaw = row.getCell(dateCol).value;
        const nameRaw = row.getCell(nameCol).value;
        if (!dateRaw || !nameRaw) return;

        let dateStr;
        if (dateRaw instanceof Date) dateStr = dateRaw.toISOString().slice(0,10);
        else dateStr = String(dateRaw).trim().slice(0,10);

        const nameKey = normName(nameRaw);
        const product = prodMap.get(nameKey);
        if (!product) { skipped++; return; }

        const qty = qtyCol ? (Number(row.getCell(qtyCol).value)||1) : 1;
        const price = priceCol ? Math.round(Number(row.getCell(priceCol).value)||0) : 0;

        const txn = insTxn.run(dateStr);
        insItem.run(txn.lastInsertRowid, product.id, qty, price, qty*price);
        imported++;
      });
    });
    tx();

    res.json({ message: `Imported: ${imported} sales, ${skipped} skipped (unmatched products)` });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

module.exports = router;

// POST /api/import/recipes — bulk import recipe lines from XLSX.
// Expected columns: Product (or "Menu"), Ingredient (or "Bahan"), Quantity (or "Qty"/"Jumlah")
router.post('/recipes', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('Recipes') || wb.getWorksheet('Recipe') || wb.worksheets[0];
    const hdr = headerMap(ws);
    const prodCol = hdr.product || hdr.menu || hdr.nama || hdr['menu item'];
    const ingCol = hdr.ingredient || hdr.bahan || hdr.name;
    const qtyCol = hdr.quantity || hdr.qty || hdr.jumlah;
    if (!prodCol || !ingCol) return res.status(400).json({ error: 'Need Product + Ingredient columns' });

    const prodMap = new Map();
    db.prepare('SELECT id, name FROM products WHERE active=1').all().forEach(p => prodMap.set(normName(p.name), p));
    const ingMap = new Map();
    db.prepare('SELECT id, name FROM ingredients WHERE active=1').all().forEach(i => ingMap.set(normName(i.name), i));

    const upsert = db.prepare('INSERT OR REPLACE INTO recipes (product_id, ingredient_id, quantity) VALUES (?,?,?)');
    let imported=0, skipped=0;

    const tx = db.transaction(() => {
      ws.eachRow((row,i) => { if(i===1)return;
        const prod = prodMap.get(normName(row.getCell(prodCol).value));
        const ing = ingMap.get(normName(row.getCell(ingCol).value));
        if(!prod||!ing){skipped++;return;}
        const qty = qtyCol ? Number(row.getCell(qtyCol).value)||0 : 1;
        upsert.run(prod.id, ing.id, qty); imported++;
      });
    });
    tx();
    res.json({ message: `Imported: ${imported} recipe lines, ${skipped} skipped` });
  } catch(e) { res.status(500).json({ error: 'Import failed: '+e.message }); }
});

// POST /api/import/master-report — import JUNE XLSX: sales + ingredient updates.
router.post('/master-report', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
    let importedSales = 0, updatedIngs = 0;

    // 1. Import Sales Detail sheet
    let salesWs = wb.getWorksheet('Sales Detail') || wb.getWorksheet('SalesDetail');
    if (salesWs) {
      const hdr = headerMap(salesWs);
      const dateCol = hdr.tanggal || hdr.date || hdr['Tanggal'];
      const nameCol = hdr.product || hdr.produk || hdr.nama || hdr.menu || hdr.item || hdr['Produk'];
      const qtyCol = hdr.quantity || hdr.jumlah || hdr.qty || hdr['Quantity'];
      const priceCol = hdr.price || hdr.harga || hdr['Harga'];

      if (dateCol !== undefined && nameCol !== undefined) {
        const prodMap = new Map();
        db.prepare('SELECT id, name FROM products WHERE active=1').all().forEach(p => {
          prodMap.set(normName(p.name), p);
        });

        const insTxn = db.prepare("INSERT INTO transactions (transacted_at, payment_method) VALUES (?,'cash')");
        const insItem = db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)");

        db.transaction(() => {
          // Group by date for transactions
          const byDate = new Map();
          salesWs.eachRow((row, i) => {
            if (i === 1) return;
            const dateRaw = row.getCell(dateCol).value;
            const nameRaw = row.getCell(nameCol).value;
            if (!dateRaw || !nameRaw) return;
            let dateStr;
            if (dateRaw instanceof Date) dateStr = dateRaw.toISOString().slice(0,10);
            else dateStr = String(dateRaw).trim().slice(0,10);
            const nameKey = normName(nameRaw);
            const product = prodMap.get(nameKey);
            if (!product) return;
            const qty = qtyCol !== undefined ? (Number(row.getCell(qtyCol).value)||1) : 1;
            const price = priceCol !== undefined ? Math.round(Number(row.getCell(priceCol).value)||0) : 0;
            if (!byDate.has(dateStr)) byDate.set(dateStr, []);
            byDate.get(dateStr).push({ product, qty, price });
          });

          for (const [date, items] of byDate) {
            const txn = insTxn.run(date);
            const txnId = txn.lastInsertRowid;
            for (const item of items) {
              insItem.run(txnId, item.product.id, item.qty, item.price, item.qty * item.price);
              importedSales++;
            }
            // Deduct stock
            deductStockForSale(txnId, items.map(i => ({ product_id: i.product.id, quantity: i.qty })));
          }
        })();
      }
    }

    // 2. Import Ingredient prices
    let ingWs = wb.getWorksheet('Ingredients');
    if (ingWs) {
      const hdr = headerMap(ingWs);
      const nameCol = hdr.name || hdr.nama || hdr.ingredient || hdr.bahan || hdr['Name'] || hdr['Ingredient'];
      const priceCol = hdr.last_purchase_price || hdr.price || hdr.harga || hdr['Last Price'] || hdr['Price'];
      const costCol = hdr.std_cost_per_base || hdr.std_cost || hdr.cost || hdr['Std Cost'];

      if (nameCol !== undefined) {
        const ingMap = new Map();
        db.prepare('SELECT id, name FROM ingredients WHERE active=1').all().forEach(i => {
          ingMap.set(normName(i.name), i);
        });

        db.transaction(() => {
          ingWs.eachRow((row, i) => {
            if (i === 1) return;
            const nameRaw = row.getCell(nameCol).value;
            if (!nameRaw) return;
            const ing = ingMap.get(normName(nameRaw));
            if (!ing) return;
            if (priceCol !== undefined) {
              const price = Math.round(Number(row.getCell(priceCol).value)||0);
              if (price > 0) db.prepare('UPDATE ingredients SET last_purchase_price=?, updated_at=datetime(\'now\') WHERE id=?').run(price, ing.id);
            }
            if (costCol !== undefined) {
              const cost = Number(row.getCell(costCol).value)||0;
              if (cost > 0) db.prepare('UPDATE ingredients SET std_cost_per_base_micro=?, updated_at=datetime(\'now\') WHERE id=?').run(Math.round(cost*1e6), ing.id);
            }
            updatedIngs++;
          });
        })();
      }
    }

    res.json({ message: `Imported: ${importedSales} sales records, updated ${updatedIngs} ingredients` });
  } catch(e) { res.status(500).json({ error: 'Import failed: '+e.message }); }
});

// POST /api/import/purchases — bulk purchase import from XLSX.
router.post('/purchases', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    const hdr = headerMap(ws);
    const ingCol = hdr.ingredient || hdr.bahan || hdr.name;
    const qtyCol = hdr.quantity || hdr.qty || hdr.jumlah;
    const costCol = hdr.total_cost || hdr.cost || hdr.total || hdr.harga;
    if (!ingCol) return res.status(400).json({ error: 'Need Ingredient column' });

    const ingMap = new Map();
    db.prepare('SELECT id, name, base_unit, purchase_unit, conv_purchase_to_base FROM ingredients WHERE active=1').all()
      .forEach(i => ingMap.set(normName(i.name), i));

    let imported = 0, skipped = 0;
    const insTxn = db.prepare("INSERT INTO purchases (purchased_at) VALUES (date('now'))");
    const insItem = db.prepare("INSERT INTO purchase_items (purchase_id, ingredient_id, purchase_qty, purchase_unit, base_qty, unit_price, line_total) VALUES (?,?,?,?,?,?,?)");

    db.transaction(() => {
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const nameRaw = row.getCell(ingCol).value;
        if (!nameRaw) return;
        const ing = ingMap.get(normName(nameRaw));
        if (!ing) { skipped++; return; }
        const qty = qtyCol !== undefined ? (Number(row.getCell(qtyCol).value)||0) : 0;
        const cost = costCol !== undefined ? Math.round(Number(row.getCell(costCol).value)||0) : 0;
        if (!(qty > 0)) return;
        const conv = Number(ing.conv_purchase_to_base) > 0 ? Number(ing.conv_purchase_to_base) : 1;
        const baseQty = qty * conv;
        const unitPrice = qty > 0 ? Math.round(cost / qty) : 0;
        const txn = insTxn.run();
        insItem.run(txn.lastInsertRowid, ing.id, qty, ing.purchase_unit || ing.base_unit, baseQty, unitPrice, cost);
        imported++;
      });
    })();

    res.json({ message: `Imported: ${imported} purchases, ${skipped} skipped` });
  } catch(e) { res.status(500).json({ error: 'Import failed: '+e.message }); }
});
