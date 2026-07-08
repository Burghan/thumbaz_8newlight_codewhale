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

module.exports = router;
