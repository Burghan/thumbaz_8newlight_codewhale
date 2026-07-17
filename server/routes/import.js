const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const db = require('../db');
const { cellValue, normName, loadWorkbookFromBuffer } = require('../lib/xlsx');
const { buildProductMatcher } = require('../lib/productMatch');
const { deductStockForSale } = require('../lib/stock');
const { voidSale } = require('../lib/voidSale');

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

// Normalize a date cell to YYYY-MM-DD. Handles Date objects and the transaction
// export's DD-MM-YYYY strings; otherwise returns the first 10 chars as-is.
const normDate = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/); // DD-MM-YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.slice(0, 10);
};

// POST /api/import/menu — upload the Products sheet to bulk-upsert menu items by name (+variant).
router.post('/menu', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let wb;
  try {
    wb = await loadWorkbookFromBuffer(req.file.buffer);
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
    const wb = await loadWorkbookFromBuffer(req.file.buffer);
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

    // Matcher understands the transaction's comma-style / variant naming and maps
    // it to the DB's canonical dash-style products.
    const matchProduct = buildProductMatcher(db);

    const insTxn = db.prepare("INSERT INTO transactions (transacted_at, payment_method) VALUES (?,'cash')");
    const insItem = db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)");

    let imported = 0, skipped = 0;
    const unmatched = new Set();
    const tx = db.transaction(() => {
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const dateRaw = row.getCell(dateCol).value;
        const nameRaw = row.getCell(nameCol).value;
        if (!dateRaw || !nameRaw) return;

        let dateStr;
        if (dateRaw instanceof Date) dateStr = dateRaw.toISOString().slice(0,10);
        else dateStr = normDate(dateRaw);

        const product = matchProduct(nameRaw);
        if (!product) { unmatched.add(String(nameRaw).trim()); skipped++; return; }

        const qty = qtyCol ? (Number(row.getCell(qtyCol).value)||1) : 1;
        const price = priceCol ? Math.round(Number(row.getCell(priceCol).value)||0) : 0;

        const txn = insTxn.run(dateStr);
        insItem.run(txn.lastInsertRowid, product.id, qty, price, qty*price);
        deductStockForSale(txn.lastInsertRowid, [{ product_id: product.id, quantity: qty }]);
        imported++;
      });
    });
    tx();

    res.json({
      message: `Imported: ${imported} sales, ${skipped} skipped (unmatched products). Inventory deducted.`,
      imported, skipped, unmatched: [...unmatched]
    });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// POST /api/import/riwayat — import the POS's "Riwayat Transaksi" export (.xls or
// .xlsx). Unlike /sales (one row = one order), this file has one row per line
// item and groups into receipts via "No. Struk". Deducts inventory
// automatically (was a manual/forgettable step before) and reports the
// post-import stock impact so nothing needs a separate check.
// A wholly cancelled receipt ("Dibatalkan", or a "Batal Sebagian" that
// cancelled every line) isn't just skipped — it's recorded at its original
// quantities and immediately voided, so void_log shows it was rung up and
// cancelled rather than it never having existed in our data.
// Also reconciles: this is the only way transactions enter the system (no
// parallel live POS), so within the date range this file covers, any receipt
// we'd previously imported that's no longer valid here (edited/voided in the
// source after an earlier import) gets voided automatically — the freshest
// export always wins.
router.post('/riwayat', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let sheetRows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  } catch (e) {
    return res.status(400).json({ error: 'Could not read the file: ' + e.message });
  }
  if (sheetRows.length < 2) return res.status(400).json({ error: 'No data rows found' });

  const header = sheetRows[0].map(h => normName(h));
  const col = (name) => header.findIndex(h => h === normName(name));
  const cNo = col('No. Struk'), cDate = col('Tanggal'), cJam = col('Jam'),
        cProd = col('Produk'), cQty = col('Jumlah Produk'), cCancel = col('Jumlah Dibatalkan'),
        cPrice = col('Harga Per Produk'), cPay = col('Metode Pembayaran');
  if (cNo < 0 || cDate < 0 || cProd < 0) {
    return res.status(400).json({ error: 'Missing expected columns (No. Struk / Tanggal / Produk) — is this a Riwayat Transaksi export?' });
  }

  const matchProduct = buildProductMatcher(db);
  const hppFor = (productId) => db.prepare(`
    SELECT (p.labor_cost+p.utility_cost+p.packaging_cost) +
      CASE WHEN p.is_resale THEN COALESCE((SELECT ROUND(ri.std_cost_per_base_micro/1e6) FROM ingredients ri WHERE ri.id=p.resale_ingredient_id),0)
      ELSE COALESCE((SELECT ROUND(SUM(r.quantity*i.std_cost_per_base_micro)/1e6) FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=p.id),0)
      END AS hpp
    FROM products p WHERE p.id=?`).get(productId).hpp;

  // A product name the matcher can't resolve (alias, exact, or variant-stripped
  // base) is a genuinely new menu item, not a data-entry error — auto-create it
  // (no recipe/category yet, priced at what this sale actually charged) rather
  // than silently dropping the sale. Repeated occurrences of the same new name
  // within this file reuse the same created product.
  // Category 'Custom' — same semantics as the existing Custom Item placeholder:
  // no recipe, priced on the fly. Recipe/HPP-based reports already exclude it.
  const insertProduct = db.prepare(`INSERT INTO products (name, category, labor_cost, utility_cost, packaging_cost, active, is_resale) VALUES (?, 'Custom', 0, 0, 0, 1, 0)`);
  const insertPrice = db.prepare('INSERT INTO product_prices (product_id, price) VALUES (?, ?)');
  const createdThisImport = new Map(); // normalized name -> product row
  function resolveOrCreateProduct(rawName, price) {
    const existing = matchProduct(rawName);
    if (existing) return { product: existing, created: false };
    const key = normName(rawName);
    if (createdThisImport.has(key)) return { product: createdThisImport.get(key), created: false };
    const name = String(rawName).trim();
    const info = insertProduct.run(name);
    const product = { id: info.lastInsertRowid, name, is_resale: 0 };
    if (price > 0) insertPrice.run(product.id, price);
    createdThisImport.set(key, product);
    return { product, created: true };
  }

  // Reconciliation prep: the source POS can be edited *after* an earlier
  // export was already imported (a receipt added late, voided, or corrected).
  // A plain additive import has no way to notice that — so first work out
  // every receipt this file still considers valid (has at least one
  // non-cancelled line) and the date range it covers. After importing what's
  // new, anything we've previously recorded with a reference in that same
  // window but missing from this set gets voided below — the fresh export
  // wins.
  // A line counts as valid by its actual remaining quantity (Jumlah Produk
  // minus Jumlah Dibatalkan), not by the Status label — "Batal Sebagian"
  // (partial cancel) is applied at the receipt level to every one of its
  // rows, even ones that weren't actually cancelled, so trusting the label
  // alone would drop real revenue on the still-valid lines of that receipt.
  const netQty = (row) => Number(row[cQty] || 1) - Number(row[cCancel] || 0);

  const validReceiptsInFile = new Set();
  let fileMinDate = null, fileMaxDate = null;
  for (const row of sheetRows.slice(1)) {
    const no = String(row[cNo] || '').trim();
    if (!no) continue;
    const dateStr = normDate(row[cDate]);
    if (dateStr) {
      if (!fileMinDate || dateStr < fileMinDate) fileMinDate = dateStr;
      if (!fileMaxDate || dateStr > fileMaxDate) fileMaxDate = dateStr;
    }
    if (!(netQty(row) > 0)) continue;
    validReceiptsInFile.add(no);
  }

  // Group by receipt number, skipping receipts already imported or already
  // recorded as a void from a prior import of this same file (a fully
  // cancelled receipt is created-then-voided below, which deletes its
  // transaction row — without also checking void_log, re-importing the same
  // file would recreate and re-void it every time).
  const already = new Set(db.prepare("SELECT reference FROM transactions WHERE reference IS NOT NULL").all().map(r => r.reference));
  const alreadyVoided = new Set(db.prepare("SELECT DISTINCT reference FROM void_log WHERE reference IS NOT NULL").all().map(r => r.reference));
  const receipts = new Map();
  let cancelledLines = 0, skippedDuplicateReceipts = new Set(), createdProducts = new Set();

  const insT = db.prepare("INSERT INTO transactions (transacted_at,payment_method,reference) VALUES (?,?,?)");
  const insI = db.prepare("INSERT INTO transaction_items (transaction_id,product_id,quantity,unit_price,line_total,hpp_at_sale) VALUES (?,?,?,?,?,?)");
  let nt = 0, ni = 0, revenue = 0;
  const autoVoided = [];

  for (const row of sheetRows.slice(1)) {
    const no = String(row[cNo] || '').trim();
    if (!no) continue;
    if (already.has(no) || alreadyVoided.has(no)) { skippedDuplicateReceipts.add(no); continue; }
    const nameRaw = row[cProd];
    if (!nameRaw) continue;
    const origQty = Number(row[cQty] || 1);
    const qty = netQty(row);
    const price = Math.round(Number(row[cPrice] || 0));
    const { product, created } = resolveOrCreateProduct(nameRaw, price);
    if (created) createdProducts.add(product.name);
    const dateStr = normDate(row[cDate]);
    const jam = String(row[cJam] || '00:00:00').trim();
    const pay = String(row[cPay] || '').toUpperCase().includes('QRIS') ? 'qris' : 'cash';
    if (!receipts.has(no)) receipts.set(no, { at: `${dateStr} ${jam}`, pay, ref: no, lines: [] });
    receipts.get(no).lines.push({ pid: product.id, qty, origQty, price, hpp: hppFor(product.id) });
  }

  db.transaction(() => {
    for (const [, r] of receipts) {
      const hasValidLine = r.lines.some((l) => l.qty > 0);
      const tr = insT.run(r.at, r.pay, r.ref);

      if (hasValidLine) {
        nt++;
        for (const l of r.lines) {
          if (!(l.qty > 0)) { cancelledLines++; continue; }
          insI.run(tr.lastInsertRowid, l.pid, l.qty, l.price, l.qty * l.price, l.hpp);
          deductStockForSale(tr.lastInsertRowid, [{ product_id: l.pid, quantity: l.qty }]);
          ni++; revenue += l.qty * l.price;
        }
      } else {
        // Every line on this receipt was cancelled ("Dibatalkan", or a
        // "Batal Sebagian" that happened to cancel everything) — record it
        // at its original (pre-cancellation) quantities so there's a real
        // transaction to void, then immediately void it. The result is a
        // void_log entry showing it was rung up and cancelled, rather than
        // the receipt simply never having existed in our data.
        for (const l of r.lines) {
          const q = l.origQty > 0 ? l.origQty : 1;
          insI.run(tr.lastInsertRowid, l.pid, q, l.price, q * l.price, l.hpp);
          deductStockForSale(tr.lastInsertRowid, [{ product_id: l.pid, quantity: q }]);
          cancelledLines++;
        }
        const result = voidSale(tr.lastInsertRowid, {
          restock: true,
          reason: 'Cancelled in source POS (Dibatalkan)',
          reference: r.ref
        });
        if (result.ok) autoVoided.push(r.ref);
      }
    }
  })();

  // Reconciliation: void any of our transactions dated within this file's
  // coverage that carry a reference no longer considered valid here — i.e.
  // the source was edited after we imported an earlier snapshot of it.
  // restock:true since these are now treated as never having happened.
  const reconciledVoids = [];
  if (fileMinDate && fileMaxDate) {
    const inRange = db.prepare(
      `SELECT id, reference FROM transactions
       WHERE reference IS NOT NULL AND substr(transacted_at, 1, 10) BETWEEN ? AND ?`
    ).all(fileMinDate, fileMaxDate);
    for (const t of inRange) {
      if (validReceiptsInFile.has(t.reference)) continue;
      const result = voidSale(t.id, {
        restock: true,
        reason: 'Riwayat re-import reconciliation: receipt no longer present in source export',
        reference: t.reference
      });
      if (result.ok) reconciledVoids.push(t.reference);
    }
  }

  // Post-import inventory impact — replaces the manual "check inventory after
  // import" step: any ingredient now at 0 needs a restock recorded.
  const outOfStock = db.prepare(`
    SELECT i.name, i.base_unit FROM inventory inv JOIN ingredients i ON i.id=inv.ingredient_id
    WHERE inv.quantity_base<=0 AND i.active=1 ORDER BY i.name`).all();

  res.json({
    message: `Imported: ${nt} transactions, ${ni} line-items, revenue Rp${revenue.toLocaleString('id-ID')}. Inventory deducted automatically.`
      + (createdProducts.size ? ` ${createdProducts.size} new product(s) added to the menu — set their category/recipe when convenient.` : '')
      + (autoVoided.length ? ` ${autoVoided.length} fully cancelled receipt(s) recorded and voided.` : '')
      + (reconciledVoids.length ? ` ${reconciledVoids.length} previously-imported order(s) voided — no longer present in this export.` : ''),
    transactions: nt, lineItems: ni, revenue,
    cancelledLinesSkipped: cancelledLines,
    duplicateReceiptsSkipped: skippedDuplicateReceipts.size,
    createdProducts: [...createdProducts],
    autoVoided,
    reconciledVoids,
    outOfStock: outOfStock.map(r => `${r.name} (${r.base_unit})`)
  });
});

// POST /api/import/inventory — reconcile a physical stock count. Round-trips
// with /api/export/inventory: expects Ingredient + Quantity On Hand columns.
// Unlike a raw overwrite, this computes the delta per ingredient and records it
// as a normal 'adjustment' stock_movement (audit trail preserved, same as the
// manual Add/Remove adjustment on the Inventory page) rather than silently
// resetting the number.
router.post('/inventory', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = await loadWorkbookFromBuffer(req.file.buffer);
    const ws = wb.getWorksheet('Inventory') || wb.worksheets[0];
    const hdr = headerMap(ws);
    const nameCol = hdr.ingredient || hdr.name;
    const qtyCol = hdr['quantity on hand'] || hdr.quantity || hdr.qty;
    if (!nameCol || !qtyCol) return res.status(400).json({ error: 'Need "Ingredient" and "Quantity On Hand" columns' });

    const ingByName = new Map();
    db.prepare('SELECT id, name FROM ingredients WHERE active=1').all().forEach(i => ingByName.set(normName(i.name), i));

    const getInv = db.prepare('SELECT quantity_base FROM inventory WHERE ingredient_id=?');
    const setInv = db.prepare("UPDATE inventory SET quantity_base=?, updated_at=datetime('now') WHERE ingredient_id=?");
    const addMove = db.prepare(`INSERT INTO stock_movements (ingredient_id, type, qty_base, unit_cost_micro, note)
      VALUES (?, 'adjustment', ?, 0, ?)`);

    let reconciled = 0, unchanged = 0, unmatched = [];
    db.transaction(() => {
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const nameRaw = row.getCell(nameCol).value;
        if (!nameRaw) return;
        const ing = ingByName.get(normName(nameRaw));
        if (!ing) { unmatched.push(String(nameRaw).trim()); return; }
        const newQtyRaw = row.getCell(qtyCol).value;
        if (newQtyRaw == null || newQtyRaw === '') return;
        const newQty = Number(newQtyRaw);
        if (!Number.isFinite(newQty)) return;

        const cur = getInv.get(ing.id);
        const oldQty = cur ? cur.quantity_base : 0;
        const delta = newQty - oldQty;
        if (Math.abs(delta) < 1e-9) { unchanged++; return; }

        setInv.run(newQty, ing.id);
        addMove.run(ing.id, delta, `Stock count reconciliation: ${oldQty} -> ${newQty}`);
        reconciled++;
      });
    })();

    res.json({
      message: `Reconciled ${reconciled} ingredient(s), ${unchanged} unchanged${unmatched.length ? `, ${unmatched.length} unmatched` : ''}.`,
      reconciled, unchanged, unmatched
    });
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
    const wb = await loadWorkbookFromBuffer(req.file.buffer);
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
    const wb = await loadWorkbookFromBuffer(req.file.buffer);
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
        const matchProduct = buildProductMatcher(db);

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
            const dateStr = normDate(dateRaw);
            const product = matchProduct(nameRaw);
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
    const wb = await loadWorkbookFromBuffer(req.file.buffer);
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
