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

// ---- Product detail (drill-down: costing breakdown + monthly sales) ----
router.get('/product-detail', (req, res) => {
  const id = Number(req.query.id);
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const p = db.prepare(`SELECT p.*, (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price FROM products p WHERE p.id=?`).get(id);
  if (!p) return res.status(404).json({ error: 'Product not found' });

  const recipe = db.prepare(`SELECT i.name, i.base_unit, r.quantity, i.std_cost_per_base_micro AS micro
    FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=? ORDER BY i.name`).all(id)
    .map(r => ({ name: r.name, base_unit: r.base_unit, quantity: r.quantity, cost: Math.round(r.quantity * r.micro / 1e6) }));

  let resaleCost = 0;
  if (p.is_resale && p.resale_ingredient_id) {
    const ri = db.prepare('SELECT std_cost_per_base_micro AS micro FROM ingredients WHERE id=?').get(p.resale_ingredient_id);
    resaleCost = ri ? Math.round(ri.micro / 1e6) : 0;
  }
  const ingredientCogs = p.is_resale ? resaleCost : recipe.reduce((s, r) => s + r.cost, 0);
  const totalCogs = ingredientCogs + p.labor_cost + p.utility_cost + p.packaging_cost;
  const price = p.price || 0;
  const margin = price > 0 ? Math.round((price - totalCogs) / price * 100) : 0;

  const stats = db.prepare(`SELECT COALESCE(SUM(ti.quantity),0) AS qty, COALESCE(SUM(ti.line_total),0) AS revenue, COUNT(DISTINCT t.id) AS orders
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id WHERE ti.product_id=? AND strftime('%Y-%m',t.transacted_at)=?`).get(id, month);
  const byDay = db.prepare(`SELECT t.transacted_at AS date, SUM(ti.quantity) AS qty, SUM(ti.line_total) AS revenue
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id WHERE ti.product_id=? AND strftime('%Y-%m',t.transacted_at)=? GROUP BY t.transacted_at ORDER BY t.transacted_at`).all(id, month);

  res.json({
    product: { id: p.id, name: p.name, category: p.category, variant: p.variant, is_resale: !!p.is_resale, price,
               labor_cost: p.labor_cost, utility_cost: p.utility_cost, packaging_cost: p.packaging_cost },
    recipe, resale_cost: resaleCost, ingredient_cogs: ingredientCogs, total_cogs: totalCogs, margin_pct: margin, stats, by_day: byDay
  });
});

// ---- Orders that sold a given product this month (drill-down from a qty cell) ----
router.get('/product-orders', (req, res) => {
  const id = Number(req.query.id);
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`SELECT t.id AS order_id, t.transacted_at AS date, t.payment_method,
      ti.quantity, ti.unit_price, ti.line_total
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ti.product_id=? AND strftime('%Y-%m',t.transacted_at)=?
    ORDER BY t.transacted_at DESC, t.id DESC`).all(id, month);
  res.json(rows);
});

// ---- Payment method mix (Cash / QRIS / Transfer) ----
router.get('/payment-mix', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT COALESCE(t.payment_method,'unknown') AS method,
           COUNT(DISTINCT t.id) AS orders, ROUND(SUM(ti.line_total)) AS revenue
    FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE strftime('%Y-%m', t.transacted_at) = ?
    GROUP BY t.payment_method ORDER BY revenue DESC`).all(month);
  const total = rows.reduce((s, r) => s + (r.revenue || 0), 0) || 1;
  res.json(rows.map(r => ({ ...r, share: Math.round(r.revenue / total * 100) })));
});

// ---- Cashflow ledger (daily inflow/outflow + running balance) ----
// Inflow = sales. Outflow = purchases + expenses (payroll salaries are booked
// as expenses, so they are not counted twice). The running balance is scoped to
// the selected month (opening = 0) so it reflects the month's own cash movement.
router.get('/cashflow', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const opening = 0;

  const salesBy = m => Object.fromEntries(db.prepare(`
    SELECT t.transacted_at AS d, ROUND(SUM(ti.line_total)) AS v
    FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE strftime('%Y-%m', t.transacted_at) = ? GROUP BY t.transacted_at`).all(m).map(r => [r.d, r.v]));
  const purchBy = m => Object.fromEntries(db.prepare(`
    SELECT p.purchased_at AS d, ROUND(SUM(pi.line_total)) AS v
    FROM purchases p JOIN purchase_items pi ON pi.purchase_id = p.id
    WHERE strftime('%Y-%m', p.purchased_at) = ? GROUP BY p.purchased_at`).all(m).map(r => [r.d, r.v]));
  const expBy = m => Object.fromEntries(db.prepare(`
    SELECT date AS d, ROUND(SUM(amount)) AS v FROM expenses
    WHERE strftime('%Y-%m', date) = ? GROUP BY date`).all(m).map(r => [r.d, r.v]));

  const sales = salesBy(month), purch = purchBy(month), exp = expBy(month);
  const days = [...new Set([...Object.keys(sales), ...Object.keys(purch), ...Object.keys(exp)])].sort();

  let balance = opening;
  let tIn = 0, tPurch = 0, tExp = 0;
  const rows = days.map(d => {
    const inflow = sales[d] || 0, purchases = purch[d] || 0, expenses = exp[d] || 0;
    const outflow = purchases + expenses, net = inflow - outflow;
    balance += net; tIn += inflow; tPurch += purchases; tExp += expenses;
    return { date: d, inflow, purchases, expenses, outflow, net, balance };
  });

  res.json({
    month, opening, rows,
    totals: { inflow: tIn, purchases: tPurch, expenses: tExp, outflow: tPurch + tExp,
              net: tIn - tPurch - tExp, closing: balance }
  });
});

// ---- Forecast (run-rate finish + trend-based next month) ----
router.get('/forecast', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  // monthly figures (revenue, COGS from recipe/resale cost, expenses, net, selling days)
  function figures(m) {
    const r = db.prepare(`SELECT COALESCE(SUM(ti.line_total),0) AS revenue,
      COALESCE(SUM(CASE WHEN p.is_resale THEN COALESCE((SELECT ri.std_cost_per_base_micro FROM ingredients ri WHERE ri.id=p.resale_ingredient_id),0)/1e6
      ELSE COALESCE((SELECT ROUND(SUM(r2.quantity*i2.std_cost_per_base_micro)/1e6) FROM recipes r2 JOIN ingredients i2 ON i2.id=r2.ingredient_id WHERE r2.product_id=p.id),0) END * ti.quantity),0) AS cogs,
      COUNT(DISTINCT t.transacted_at) AS days
      FROM transactions t JOIN transaction_items ti ON ti.transaction_id=t.id JOIN products p ON p.id=ti.product_id
      WHERE strftime('%Y-%m',t.transacted_at)=?`).get(m);
    const exp = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE strftime('%Y-%m', date) = ?").get(m).v;
    return { month: m, revenue: Math.round(r.revenue), cogs: Math.round(r.cogs), expenses: Math.round(exp),
             net: Math.round(r.revenue - r.cogs - exp), selling_days: r.days };
  }

  // build history: up to the 6 months ending at the selected month, dropping empties
  const hist = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(month + '-01'); d.setMonth(d.getMonth() - i);
    const f = figures(d.toISOString().slice(0, 7));
    if (f.revenue > 0 || f.expenses > 0) hist.push(f);
  }

  const cur = figures(month);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const avgDayRev = cur.selling_days ? cur.revenue / cur.selling_days : 0;
  const avgDayNet = cur.selling_days ? cur.net / cur.selling_days : 0;
  const runrate = {
    selling_days: cur.selling_days, days_in_month: daysInMonth,
    avg_daily_revenue: Math.round(avgDayRev), avg_daily_net: Math.round(avgDayNet),
    projected_revenue: Math.round(avgDayRev * daysInMonth),
    projected_net: Math.round(avgDayNet * daysInMonth),
    complete: cur.selling_days >= daysInMonth
  };

  // next-month projection: linear regression when we have >=3 months of history
  // (a real trend); otherwise a flat continuation of the current run-rate — 2
  // data points aren't enough to trust a growth curve, so we don't compound it.
  const nd = new Date(month + '-01'); nd.setMonth(nd.getMonth() + 1);
  const nextMonth = nd.toISOString().slice(0, 7);
  const rev = hist.map(h => h.revenue);
  let projRev, method;
  if (rev.length >= 3) {
    const n = rev.length, xs = rev.map((_, i) => i);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = rev.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (rev[i] - my); den += (x - mx) ** 2; });
    const slope = den ? num / den : 0, intercept = my - slope * mx;
    projRev = Math.max(0, Math.round(intercept + slope * n));
    method = 'linear-trend';
  } else {
    projRev = Math.max(0, runrate.projected_revenue || cur.revenue);
    method = 'run-rate';
  }
  const growth = cur.revenue ? Math.round((projRev - cur.revenue) / cur.revenue * 1000) / 10 : 0;
  // hold current cost/expense ratios constant for the projection
  const cogsRatio = cur.revenue ? cur.cogs / cur.revenue : 0;
  const expRatio = cur.revenue ? cur.expenses / cur.revenue : 0;
  const projCogs = Math.round(projRev * cogsRatio), projExp = Math.round(projRev * expRatio);
  const next = { month: nextMonth, revenue: projRev, cogs: projCogs, expenses: projExp,
                 net: projRev - projCogs - projExp, method, growth_pct: growth };

  res.json({ month, history: hist, current: cur, runrate, next });
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
