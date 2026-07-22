const express = require('express');
const db = require('../db');

const router = express.Router();

// Default OPEX categories from the JUNI workbook (used to seed a fresh month).
const DEFAULT_OPEX = ['Gaji Karyawan', 'Overtime', 'Es Batu', 'Listrik & PDAM', 'Air', 'Internet', 'Bensin', 'Marketing', 'Maintenance'];

function revenueActual(month) {
  return db.prepare(`
    SELECT COALESCE(SUM(ti.line_total),0) AS v
    FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE strftime('%Y-%m', t.transacted_at) = ?`).get(month).v;
}

function cogsActuals(month) {
  return db.prepare(`
    SELECT COALESCE(i.category,'Uncategorized') AS category, ROUND(SUM(pi.line_total)) AS actual
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    JOIN ingredients i ON i.id = pi.ingredient_id
    WHERE strftime('%Y-%m', p.purchased_at) = ?
    GROUP BY i.category`).all(month);
}

function opexActuals(month) {
  const expenseRows = db.prepare(`
    SELECT COALESCE(category,'Uncategorized') AS category, ROUND(SUM(amount)) AS actual
    FROM expenses WHERE strftime('%Y-%m', date) = ? GROUP BY category`).all(month);

  // Cash Out from a POS shift (Cash In/Out) is real money leaving the till,
  // just recorded during a shift instead of the separate Expenses log —
  // counts toward OPEX actual too. Bucketed under one category since a
  // cash-out only has a freeform reason, not a budget category to match.
  const cashOut = db.prepare(`
    SELECT ROUND(SUM(amount)) AS actual FROM cash_movements
    WHERE type = 'out' AND strftime('%Y-%m', created_at) = ?`).get(month);

  if (cashOut.actual > 0) expenseRows.push({ category: 'Cash Out (POS)', actual: cashOut.actual });
  return expenseRows;
}

// Merge budget rows (of a kind) with computed actuals into unified lines.
function buildLines(month, kind, actualRows) {
  const budgetRows = db.prepare('SELECT category, amount, sort_order FROM budgets WHERE month = ? AND kind = ?').all(month, kind);
  const map = new Map();
  budgetRows.forEach(b => map.set(b.category, { category: b.category, budget: b.amount, actual: 0, sort_order: b.sort_order }));
  actualRows.forEach(a => {
    const cur = map.get(a.category) || { category: a.category, budget: 0, actual: 0, sort_order: 999 };
    cur.actual = a.actual || 0;
    map.set(a.category, cur);
  });
  return [...map.values()]
    .sort((a, b) => a.sort_order - b.sort_order || a.category.localeCompare(b.category))
    .map(l => {
      const variance = l.actual - l.budget;
      return { ...l, variance, pct_used: l.budget > 0 ? Math.round(l.actual / l.budget * 100) : null };
    });
}

// GET /api/budget?month=YYYY-MM  — budget vs actual, fully computed.
router.get('/', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const revActual = revenueActual(month);
  const revBudget = db.prepare("SELECT amount FROM budgets WHERE month=? AND kind='revenue' AND category='Total Revenue'").get(month);

  const revenue = {
    budget: revBudget ? revBudget.amount : 0,
    actual: revActual,
    get variance() { return this.actual - this.budget; }
  };
  const cogs = buildLines(month, 'cogs', cogsActuals(month));
  const opex = buildLines(month, 'opex', opexActuals(month));

  const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
  const cogsB = sum(cogs, 'budget'), cogsA = sum(cogs, 'actual');
  const opexB = sum(opex, 'budget'), opexA = sum(opex, 'actual');
  const grossB = revenue.budget - cogsB, grossA = revActual - cogsA;
  const netB = grossB - opexB, netA = grossA - opexA;
  const p = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;

  res.json({
    month,
    revenue: { budget: revenue.budget, actual: revActual, variance: revActual - revenue.budget },
    cogs, opex,
    totals: {
      cogs: { budget: cogsB, actual: cogsA },
      opex: { budget: opexB, actual: opexA },
      gross_profit: { budget: grossB, actual: grossA, margin_pct: p(grossA, revActual) },
      net_profit: { budget: netB, actual: netA, margin_pct: p(netA, revActual) },
      cogs_pct: p(cogsA, revActual),
      opex_pct: p(opexA, revActual)
    }
  });
});

// PUT /api/budget?month=YYYY-MM  — bulk upsert budget amounts.
// body: { lines: [{ kind, category, amount, sort_order }] }
router.put('/', (req, res) => {
  const month = req.query.month || (req.body && req.body.month);
  if (!month) return res.status(400).json({ error: 'month required' });
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const up = db.prepare(`
    INSERT INTO budgets (month, kind, category, amount, sort_order)
    VALUES (?,?,?,?,?)
    ON CONFLICT(month, kind, category)
    DO UPDATE SET amount = excluded.amount, sort_order = excluded.sort_order, updated_at = datetime('now')`);
  const tx = db.transaction(() => {
    lines.forEach((l, i) => {
      if (!l.kind || !l.category) return;
      up.run(month, l.kind, String(l.category).trim(), Math.round(Number(l.amount || 0)), Number(l.sort_order ?? i));
    });
  });
  tx();
  res.json({ message: 'Budget saved' });
});

// POST /api/budget/copy  { month, from }  — copy amounts from another month,
// or seed default categories if `from` is omitted / empty.
router.post('/copy', (req, res) => {
  const { month, from } = req.body || {};
  if (!month) return res.status(400).json({ error: 'month required' });
  const up = db.prepare(`
    INSERT INTO budgets (month, kind, category, amount, sort_order)
    VALUES (?,?,?,?,?)
    ON CONFLICT(month, kind, category) DO UPDATE SET amount = excluded.amount, sort_order = excluded.sort_order`);
  const tx = db.transaction(() => {
    if (from) {
      const src = db.prepare('SELECT kind, category, amount, sort_order FROM budgets WHERE month = ?').all(from);
      src.forEach(s => up.run(month, s.kind, s.category, s.amount, s.sort_order));
    } else {
      up.run(month, 'revenue', 'Total Revenue', 0, 0);
      db.prepare("SELECT DISTINCT COALESCE(category,'Uncategorized') c FROM ingredients WHERE active=1 AND IFNULL(category,'')<>'__resale'").all()
        .forEach((r, i) => up.run(month, 'cogs', r.c, 0, i));
      DEFAULT_OPEX.forEach((c, i) => up.run(month, 'opex', c, 0, i));
    }
  });
  tx();
  res.json({ message: from ? `Copied budget from ${from}` : 'Seeded default budget lines' });
});

module.exports = router;
