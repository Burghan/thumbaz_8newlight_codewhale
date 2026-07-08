const express = require('express');
const db = require('../db');

const router = express.Router();

// List categories with how many products use each.
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.sort_order, c.active,
      (SELECT COUNT(*) FROM products p WHERE LOWER(p.category) = LOWER(c.name)) AS product_count
    FROM product_categories c
    ORDER BY c.sort_order, c.name`).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const info = db.prepare('INSERT INTO product_categories (name) VALUES (?)').run(name);
    res.json({ message: 'Category added', id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'Category already exists' });
  }
});

// Rename cascades to products carrying the old name.
router.put('/:id', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const cur = db.prepare('SELECT name FROM product_categories WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Category not found' });
  try {
    db.transaction(() => {
      db.prepare("UPDATE product_categories SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.params.id);
      db.prepare('UPDATE products SET category = ? WHERE LOWER(category) = LOWER(?)').run(name, cur.name);
    })();
    res.json({ message: 'Category updated' });
  } catch {
    res.status(409).json({ error: 'Category name already exists' });
  }
});

// Block delete while any product still uses the category.
router.delete('/:id', (req, res) => {
  const cur = db.prepare('SELECT name FROM product_categories WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Category not found' });
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM products WHERE LOWER(category) = LOWER(?)').get(cur.name).n;
  if (inUse > 0) return res.status(409).json({ error: `In use by ${inUse} menu item(s) — reassign them first` });
  db.prepare('DELETE FROM product_categories WHERE id = ?').run(req.params.id);
  res.json({ message: 'Category deleted' });
});

module.exports = router;
