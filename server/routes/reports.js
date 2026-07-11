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

// ---- Per-product sales breakdown for a month (drill-down source) ----
// Uses hpp_at_sale captured on each line for accurate historical COGS.
router.get('/product-sales', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.variant,
           SUM(ti.quantity) AS qty,
           SUM(ti.line_total) AS revenue,
           SUM(CASE WHEN COALESCE(ti.hpp_at_sale,0) > 0 THEN ti.hpp_at_sale
                ELSE (SELECT COALESCE(ROUND(SUM(r.quantity*i.std_cost_per_base_micro)/1e6),0)
                        FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=p.id)
                     + p.labor_cost + p.utility_cost + p.packaging_cost
                END * ti.quantity) AS cogs,
           COUNT(DISTINCT t.id) AS orders
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN products p ON p.id = ti.product_id
    WHERE strftime('%Y-%m', t.transacted_at) = ?
    GROUP BY p.id
    ORDER BY revenue DESC
  `).all(month);
  res.json(rows.map(r => {
    const profit = (r.revenue || 0) - (r.cogs || 0);
    return { ...r, profit, margin_pct: r.revenue > 0 ? Math.round(profit / r.revenue * 100) : 0 };
  }));
});

// ---- Top products by sales ----
router.get('/top-products', (req, res) => {
  const month = req.query.month||new Date().toISOString().slice(0,7);
  res.json(db.prepare(`SELECT p.name,SUM(ti.quantity) AS qty,SUM(ti.line_total) AS revenue FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id JOIN products p ON p.id=ti.product_id WHERE strftime('%Y-%m',t.transacted_at)=? GROUP BY p.id ORDER BY revenue DESC LIMIT 5`).all(month));
});

// ---- KPI scorecard vs targets (mirrors the workbook KPI Dashboard) ----
router.get('/kpi-scorecard', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const revenue = db.prepare(`SELECT COALESCE(SUM(ti.line_total),0) v FROM transactions t JOIN transaction_items ti ON ti.transaction_id=t.id WHERE strftime('%Y-%m',t.transacted_at)=?`).get(month).v;
  const cogs = db.prepare(`SELECT COALESCE(ROUND(SUM(pi.line_total)),0) v FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE strftime('%Y-%m',p.purchased_at)=?`).get(month).v;
  const opex = db.prepare(`SELECT COALESCE(ROUND(SUM(amount)),0) v FROM expenses WHERE strftime('%Y-%m',date)=?`).get(month).v;
  const days = db.prepare(`SELECT COUNT(DISTINCT t.transacted_at) d FROM transactions t WHERE strftime('%Y-%m',t.transacted_at)=?`).get(month).d;
  const gross = revenue - cogs, net = gross - opex;
  const r = n => revenue > 0 ? Math.round(n / revenue * 1000) / 10 : 0;

  const actuals = {
    gross_margin: r(gross),
    cogs_ratio: r(cogs),
    opex_ratio: r(opex),
    net_margin: r(net)
  };

  function status(t, a) {
    if (t.direction === 'min') return a >= t.target_low ? 'good' : (a >= t.target_low * 0.9 ? 'warn' : 'bad');
    if (t.direction === 'max') return a <= t.target_high ? 'good' : (a <= t.target_high * 1.1 ? 'warn' : 'bad');
    if (t.direction === 'range') return (a >= t.target_low && a <= t.target_high) ? 'good' : ((a >= t.target_low * 0.8 && a <= t.target_high * 1.2) ? 'warn' : 'bad');
    return 'warn';
  }
  function targetText(t) {
    if (t.direction === 'min') return `≥ ${t.target_low}${t.unit}`;
    if (t.direction === 'max') return `≤ ${t.target_high}${t.unit}`;
    return `${t.target_low}–${t.target_high}${t.unit}`;
  }

  const targets = db.prepare('SELECT * FROM kpi_targets ORDER BY sort_order').all();
  const kpis = targets.map(t => {
    const a = actuals[t.metric];
    return { metric: t.metric, label: t.label, actual: a, unit: t.unit,
             target: targetText(t), direction: t.direction, target_low: t.target_low, target_high: t.target_high,
             status: a == null ? 'warn' : status(t, a) };
  });

  res.json({
    month, kpis,
    info: {
      revenue, cogs, opex, gross_profit: gross, net_profit: net,
      total_expense: cogs + opex,
      avg_daily_sales: days > 0 ? Math.round(revenue / days) : 0,
      selling_days: days
    }
  });
});

// PUT /api/reports/kpi-targets  — bulk update targets. body:{ targets:[{metric,target_low,target_high}] }
router.put('/kpi-targets', (req, res) => {
  const rows = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const up = db.prepare('UPDATE kpi_targets SET target_low=?, target_high=? WHERE metric=?');
  db.transaction(() => rows.forEach(t => up.run(
    t.target_low === '' || t.target_low == null ? null : Number(t.target_low),
    t.target_high === '' || t.target_high == null ? null : Number(t.target_high),
    t.metric)))();
  res.json({ message: 'Targets updated' });
});

// ---- Stubs ----
router.get('/purchase-vs-usage', (req, res) => res.json([]));
router.get('/low-stock-forecast', (req, res) => res.json([]));
router.get('/menu', (req, res) => res.json([]));

module.exports = router;
