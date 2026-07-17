const path = require('path');
const express = require('express');
const runMigrations = require('./migrate');
const db = require('./db');

// Bring the schema up to date before serving.
runMigrations();

const { attachSession, requireRole, sessionGate } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use('/api', attachSession);

const manager = requireRole(['admin', 'manager']);

// --- API routes (added domain by domain) ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', manager, require('./routes/users'));
app.use('/api/ingredients', manager, require('./routes/ingredients'));
app.get('/api/ingredients/list', (req, res) => res.redirect('/api/ingredients'));
app.use('/api/products', manager, require('./routes/products'));
app.use('/api/categories', manager, require('./routes/categories'));
app.use('/api/ingredient-categories', manager, require('./routes/ingredient-categories'));
app.use('/api/recipes', manager, require('./routes/recipes'));
app.use('/api/export', manager, require('./routes/export'));
app.use('/api/invoices', manager, require('./routes/invoices'));
app.use('/api/import', manager, require('./routes/import'));
app.use('/api/suppliers', manager, require('./routes/suppliers'));
app.use('/api/purchases', manager, require('./routes/purchases'));
app.use('/api/expenses', manager, require('./routes/expenses'));
app.use('/api/attendance', manager, require('./routes/attendance'));
app.use('/api/inventory', manager, require('./routes/inventory'));
app.use('/api/receipt', manager, require('./routes/receipt'));
app.use('/api/transactions', manager, require('./routes/transactions'));
app.use('/api/sales', manager, require('./routes/sales'));
app.use('/api/modifiers', requireRole(['admin', 'manager', 'staff']), require('./routes/modifiers'));
app.use('/api/kitchen', requireRole(['admin', 'manager', 'staff']), require('./routes/kitchen'));
app.use('/api/pos-ingredients', requireRole(['admin', 'manager', 'staff']), require('./routes/pos-ingredients'));
app.use('/api/pos-category-sales', requireRole(['admin', 'manager', 'staff']), require('./routes/pos-category-sales'));
app.use('/api/customers', requireRole(['admin', 'manager', 'staff']), require('./routes/customers'));
app.use('/api/loyalty-config', requireRole(['admin', 'manager', 'staff']), require('./routes/loyalty-config'));
app.use('/api/order-types', requireRole(['admin', 'manager', 'staff']), require('./routes/order-types'));
app.use('/api/qr', requireRole(['admin', 'manager', 'staff']), require('./routes/qr'));
app.get('/api/clock/status', (req, res) => res.json({active:false,employee:null}));
app.use('/api/reports', manager, require('./routes/reports'));
app.use('/api/budget', manager, require('./routes/budget'));

app.get('/api/health', (_req, res) => {
  const counts = ['ingredients', 'products', 'recipes', 'suppliers', 'purchases']
    .reduce((acc, t) => {
      acc[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
      return acc;
    }, {});
  res.json({ status: 'OK', db: db.dbPath, counts });
});

// New POS concept (register UI) — ported from the old coffee-pos prototype for
// side-by-side comparison with pos.html. Path doesn't end in .html so it falls
// outside sessionGate's isHtml check below; gate it here the same way.
app.get(/^\/pos\/ui\/[^/]+(\/.*)?$/, attachSession, (req, res) => {
  if (!req.user) {
    return res.redirect(`/login.html?next=${encodeURIComponent(req.path)}`);
  }
  res.sendFile(path.join(__dirname, '../public/pos-new.html'));
});

// --- static back-office UI (guarded) ---
app.use(sessionGate);
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    }
  }
}));

app.get('/health', (_req, res) => res.json({ status: 'OK' }));

const PORT = Number(process.env.PORT || 3101);
app.listen(PORT, () => {
  console.log(`🚀 thumbaz_8newlight back-office at http://localhost:${PORT}`);
  console.log(`📦 db: ${db.dbPath}`);
});
