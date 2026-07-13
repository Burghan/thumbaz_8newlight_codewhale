const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { microToRupiah } = require('../lib/money');

const router = express.Router();

// GET /api/export/menu — 3-sheet workbook (round-trips with /api/import/menu).
router.get('/menu', async (_req, res) => {
  const products = db.prepare(`
    SELECT p.*,
      (SELECT price FROM product_prices pp WHERE pp.product_id = p.id AND pp.effective_to IS NULL
        ORDER BY pp.id DESC LIMIT 1) AS price,
      COALESCE((SELECT ROUND(SUM(r.quantity * i.std_cost_per_base_micro) / 1e6)
        FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.product_id = p.id), 0) AS hpp_ingredients
    FROM products p ORDER BY p.name`).all();

  const recipes = db.prepare(`
    SELECT p.name AS product, p.variant, i.name AS ingredient, r.quantity, i.base_unit AS unit
    FROM recipes r
    JOIN products p ON p.id = r.product_id
    JOIN ingredients i ON i.id = r.ingredient_id
    ORDER BY p.name, i.name`).all();

  const ingredients = db.prepare('SELECT * FROM ingredients ORDER BY name').all();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'thumbaz_8newlight';

  const ps = wb.addWorksheet('Products');
  ps.columns = [
    { header: 'ID', key: 'id', width: 6 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Variant', key: 'variant', width: 14 },
    { header: 'Selling Price', key: 'price', width: 14 },
    { header: 'Labor', key: 'labor_cost', width: 10 },
    { header: 'Utility', key: 'utility_cost', width: 10 },
    { header: 'Wifi', key: 'wifi_cost', width: 10 },
    { header: 'HPP Ingredients', key: 'hpp', width: 16 },
    { header: 'Notes', key: 'notes', width: 24 },
    { header: 'Active', key: 'active', width: 8 }
  ];
  products.forEach(p => ps.addRow({
    id: p.id, name: p.name, category: p.category, variant: p.variant,
    price: p.price || 0, labor_cost: p.labor_cost, utility_cost: p.utility_cost,
    wifi_cost: p.packaging_cost, hpp: p.hpp_ingredients, notes: p.notes, active: p.active
  }));
  ps.getRow(1).font = { bold: true };

  const rs = wb.addWorksheet('Recipes');
  rs.columns = [
    { header: 'Product', key: 'product', width: 26 },
    { header: 'Variant', key: 'variant', width: 14 },
    { header: 'Ingredient', key: 'ingredient', width: 26 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit', key: 'unit', width: 8 }
  ];
  recipes.forEach(r => rs.addRow(r));
  rs.getRow(1).font = { bold: true };

  const is = wb.addWorksheet('Ingredients');
  is.columns = [
    { header: 'ID', key: 'id', width: 6 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Base Unit', key: 'base_unit', width: 10 },
    { header: 'Purchase Unit', key: 'purchase_unit', width: 14 },
    { header: 'Pack Size', key: 'conv', width: 12 },
    { header: 'Last Price', key: 'last_price', width: 12 },
    { header: 'HPP per Base', key: 'hpp', width: 14 },
    { header: 'Notes', key: 'notes', width: 24 }
  ];
  ingredients.forEach(i => is.addRow({
    id: i.id, name: i.name, category: i.category, base_unit: i.base_unit,
    purchase_unit: i.purchase_unit, conv: i.conv_purchase_to_base,
    last_price: i.last_purchase_price, hpp: microToRupiah(i.std_cost_per_base_micro), notes: i.notes
  }));
  is.getRow(1).font = { bold: true };

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=menu_export_${today}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/export/inventory — current stock snapshot (round-trips with
// /api/import/inventory for a physical-count reconciliation).
router.get('/inventory', async (_req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.name, i.category, i.base_unit, inv.quantity_base,
      CAST(inv.avg_cost_micro AS REAL)/1e6 AS avg_cost, i.min_stock
    FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id
    WHERE i.active = 1
    ORDER BY i.name`).all();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'thumbaz_8newlight';
  const ws = wb.addWorksheet('Inventory');
  ws.columns = [
    { header: 'Ingredient', key: 'name', width: 26 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Base Unit', key: 'base_unit', width: 10 },
    { header: 'Quantity On Hand', key: 'qty', width: 16 },
    { header: 'Avg Cost / Unit', key: 'avg_cost', width: 14 },
    { header: 'Total Value', key: 'value', width: 14 },
    { header: 'Min Stock', key: 'min_stock', width: 10 }
  ];
  rows.forEach(r => ws.addRow({
    name: r.name, category: r.category, base_unit: r.base_unit,
    qty: r.quantity_base, avg_cost: Math.round(r.avg_cost),
    value: Math.round(r.quantity_base * r.avg_cost), min_stock: r.min_stock
  }));
  ws.getRow(1).font = { bold: true };
  ws.addRow([]);
  ws.addRow(['To reconcile a physical count: edit "Quantity On Hand" and re-import via Inventory → Import. Other columns are ignored on import.']);

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=inventory_${today}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/export/recipes — recipe data with costs.
router.get('/recipes', async (_req, res) => {
  const rows = db.prepare(`
    SELECT p.id AS product_id, p.name AS product, p.variant, p.category,
           i.name AS ingredient, r.quantity, i.base_unit AS unit,
           CAST(i.std_cost_per_base_micro AS REAL)/1e6 AS cost_per_base,
           CAST(r.quantity * i.std_cost_per_base_micro AS REAL)/1e6 AS line_cost,
           (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price,
           p.labor_cost, p.utility_cost, p.packaging_cost
    FROM products p
    LEFT JOIN recipes r ON r.product_id=p.id
    LEFT JOIN ingredients i ON i.id=r.ingredient_id
    WHERE p.active=1
      AND p.is_resale=0
      AND COALESCE(p.category,'') <> 'Custom'
      AND (
        COALESCE(p.category,'') NOT IN ('Snack','Speciality','Air Mineral')
        OR EXISTS (SELECT 1 FROM recipes r2 WHERE r2.product_id=p.id)
      )
    ORDER BY p.category, p.name, i.name
  `).all();

  const wb = new ExcelJS.Workbook(); wb.creator = 'thumbaz_8newlight';
  const ws = wb.addWorksheet('Recipes');
  ws.columns = [
    { header: 'Product', key: 'product', width: 26 },
    { header: 'Variant', key: 'variant', width: 14 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Ingredient', key: 'ingredient', width: 26 },
    { header: 'Qty', key: 'quantity', width: 10 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Cost/Unit', key: 'cost_per_base', width: 12 },
    { header: 'Line Cost', key: 'line_cost', width: 14 },
    { header: 'HPP Total', key: 'hpp_total', width: 14 },
    { header: 'Price', key: 'price', width: 14 },
    { header: 'Margin %', key: 'margin', width: 10 }
  ];

  // Group by product so product-level cells (name, variant, category, HPP,
  // price, margin) appear once as merged cells spanning that product's rows.
  const groups = [];
  for (const r of rows) {
    let g = groups.length && groups[groups.length - 1].id === r.product_id ? groups[groups.length - 1] : null;
    if (!g) { g = { id: r.product_id, head: r, lines: [] }; groups.push(g); }
    g.lines.push(r);
  }

  // Merge the product-level columns (Product, Variant, Category, HPP, Price, Margin).
  const MERGE_COLS = [1, 2, 3, 9, 10, 11];
  groups.forEach(g => {
    const h = g.head;
    const ingredientCost = g.lines.reduce((s, r) => s + (r.line_cost || 0), 0);
    const hpp = ingredientCost + (h.labor_cost || 0) + (h.utility_cost || 0) + (h.packaging_cost || 0);
    const margin = h.price > 0 ? Math.round((h.price - hpp) / h.price * 100) : '';
    const startRow = ws.rowCount + 1;
    g.lines.forEach((r, idx) => {
      ws.addRow({
        product: idx === 0 ? h.product : '',
        variant: idx === 0 ? (h.variant || '') : '',
        category: idx === 0 ? (h.category || '') : '',
        ingredient: r.ingredient || '',
        quantity: r.quantity, unit: r.unit,
        cost_per_base: r.cost_per_base, line_cost: r.line_cost,
        hpp_total: idx === 0 ? hpp : '',
        price: idx === 0 ? (h.price || 0) : '',
        margin: idx === 0 ? margin : ''
      });
    });
    const endRow = ws.rowCount;
    if (endRow > startRow) {
      MERGE_COLS.forEach(c => ws.mergeCells(startRow, c, endRow, c));
    }
    MERGE_COLS.forEach(c => { ws.getCell(startRow, c).alignment = { vertical: 'top' }; });
  });
  ws.getRow(1).font = { bold: true };

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=recipe_export_${today}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});


module.exports = router;

// GET /api/export/sales-daily — export today's sales as XLSX.
router.get('/sales-daily', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT t.id AS txn_id, t.transacted_at AS date, t.payment_method,
           p.name AS product, ti.quantity, ti.unit_price, ti.line_total
    FROM transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id
    JOIN products p ON p.id = ti.product_id
    WHERE t.transacted_at = ?
    ORDER BY t.id, p.name`).all(date);

  const wb = new ExcelJS.Workbook(); wb.creator = 'thumbaz_8newlight';
  const ws = wb.addWorksheet('Sales');
  ws.columns = [
    { header: 'Txn #', key: 'txn_id', width: 10 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Payment', key: 'payment_method', width: 12 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Qty', key: 'quantity', width: 8 },
    { header: 'Price', key: 'unit_price', width: 12 },
    { header: 'Line Total', key: 'line_total', width: 14 }
  ];
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true };

  // Summary sheet
  const ws2 = wb.addWorksheet('Summary');
  const total = rows.reduce((s,r)=>s+r.line_total,0);
  ws2.addRow(['Total Sales', '', '', '', '', '', total]);
  ws2.addRow(['Date', date, '', '', '', '', '']);
  ws2.addRow(['Transactions', new Set(rows.map(r=>r.txn_id)).size, '', '', '', '', '']);
  ws2.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=sales_${date}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});
