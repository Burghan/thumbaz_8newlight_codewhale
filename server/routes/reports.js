const express = require('express');
const db = require('../db');
const router = express.Router();

// ---- Dashboard: monthly summary (with expenses) ----
router.get('/monthly-summary', (req, res) => {
  const now = new Date();
  const month = (req.query.month||now.toISOString().slice(0,7));
  const d = new Date(month+'-01');
  d.setMonth(d.getMonth()-1);
  const prevMonth = d.toISOString().slice(0,7);

  function s(m) {
    const exp = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE strftime('%Y-%m', date) = ?").get(m);
    const r = db.prepare(`SELECT COALESCE(SUM(ti.line_total),0) AS revenue,
      COALESCE(SUM(CASE WHEN p.is_resale THEN COALESCE((SELECT ri.std_cost_per_base_micro FROM ingredients ri WHERE ri.id=p.resale_ingredient_id),0)/1e6
      ELSE COALESCE((SELECT ROUND(SUM(r2.quantity*i2.std_cost_per_base_micro)/1e6) FROM recipes r2 JOIN ingredients i2 ON i2.id=r2.ingredient_id WHERE r2.product_id=p.id),0) END * ti.quantity),0) AS cost,
      COUNT(DISTINCT t.id) AS orders FROM transactions t JOIN transaction_items ti ON ti.transaction_id=t.id JOIN products p ON p.id=ti.product_id WHERE strftime('%Y-%m',t.transacted_at)=?`).get(m);
    const profit = r.revenue - r.cost - exp.total;
    const margin = r.revenue > 0 ? Math.round(profit/r.revenue*100) : 0;
    return { revenue: r.revenue, cost: r.cost, expenses: exp.total, profit, margin_pct: margin, order_count: r.orders };
  }
  res.json({ current: s(month), previous: s(prevMonth), month });
});

// ---- Monthly breakdown ----
router.get('/monthly', (req, res) => {
  const month = req.query.month||new Date().toISOString().slice(0,7);
  const exp = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE strftime('%Y-%m', date) = ?").get(month);
  const r = db.prepare(`SELECT COALESCE(SUM(ti.line_total),0) AS revenue,
    COALESCE(SUM(CASE WHEN p.is_resale THEN COALESCE((SELECT ri.std_cost_per_base_micro FROM ingredients ri WHERE ri.id=p.resale_ingredient_id),0)/1e6
    ELSE COALESCE((SELECT ROUND(SUM(r2.quantity*i2.std_cost_per_base_micro)/1e6) FROM recipes r2 JOIN ingredients i2 ON i2.id=r2.ingredient_id WHERE r2.product_id=p.id),0) END * ti.quantity),0) AS cogs,
    COUNT(DISTINCT t.id) AS order_count FROM transactions t JOIN transaction_items ti ON ti.transaction_id=t.id JOIN products p ON p.id=ti.product_id WHERE strftime('%Y-%m',t.transacted_at)=?`).get(month);
  const profit = r.revenue - r.cogs - exp.total;
  res.json({ ...r, labor:0, other_cost:0, expenses:exp.total, profit, gross_profit:profit, net_profit:profit, sales_count:r.order_count });
});

// ---- Daily breakdown ----
router.get('/daily', (req, res) => {
  const month = req.query.month||new Date().toISOString().slice(0,7);
  const rows = db.prepare(`SELECT t.transacted_at AS date, SUM(ti.line_total) AS revenue, COUNT(DISTINCT t.id) AS order_count FROM transactions t JOIN transaction_items ti ON ti.transaction_id=t.id WHERE strftime('%Y-%m',t.transacted_at)=? GROUP BY t.transacted_at ORDER BY t.transacted_at`).all(month);
  res.json(rows);
});

// ---- Recipe costing ----
router.get('/recipe-costing', (req, res) => {
  const rows = db.prepare(`SELECT p.id,p.name,p.category,p.variant,(SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price,
    COALESCE((SELECT ROUND(SUM(r.quantity*i.std_cost_per_base_micro)/1e6) FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=p.id),0) AS ingredient_cogs,
    p.labor_cost,p.utility_cost,p.packaging_cost,(SELECT COUNT(*) FROM recipes r WHERE r.product_id=p.id) AS recipe_count FROM products p WHERE p.active=1 ORDER BY p.category,p.name`).all();
  res.json(rows.map(r=>{const cogs=r.ingredient_cogs+r.labor_cost+r.utility_cost+r.packaging_cost;const price=r.price||0;return{...r,total_cogs:cogs,margin_pct:price>0?Math.round((price-cogs)/price*100):0};}));
});

// ---- Inventory valuation ----
router.get('/inventory-valuation', (req, res) => {
  res.json(db.prepare(`SELECT i.id,i.name,i.category,i.base_unit,inv.quantity_base,CAST(inv.avg_cost_micro AS REAL)/1e6 AS avg_cost,ROUND(inv.quantity_base*CAST(inv.avg_cost_micro AS REAL)/1e6) AS total_value,i.min_stock FROM inventory inv JOIN ingredients i ON i.id=inv.ingredient_id WHERE i.active=1 ORDER BY i.name`).all());
});

// ---- Top products by sales ----
router.get('/top-products', (req, res) => {
  const month = req.query.month||new Date().toISOString().slice(0,7);
  res.json(db.prepare(`SELECT p.name,SUM(ti.quantity) AS qty,SUM(ti.line_total) AS revenue FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id JOIN products p ON p.id=ti.product_id WHERE strftime('%Y-%m',t.transacted_at)=? GROUP BY p.id ORDER BY revenue DESC LIMIT 5`).all(month));
});

// ---- Stubs ----
router.get('/purchase-vs-usage', (req, res) => res.json([]));
router.get('/low-stock-forecast', (req, res) => res.json([]));
router.get('/menu', (req, res) => res.json([]));

module.exports = router;
