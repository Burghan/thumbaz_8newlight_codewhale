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

module.exports = router;
