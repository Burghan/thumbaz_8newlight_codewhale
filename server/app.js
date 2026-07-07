const path = require('path');
const express = require('express');
const runMigrations = require('./migrate');
const db = require('./db');

// Bring the schema up to date before serving.
runMigrations();

const app = express();
app.use(express.json());

// --- API routes (added domain by domain) ---
// app.use('/api/ingredients', require('./routes/ingredients'));
// app.use('/api/suppliers', require('./routes/suppliers'));
// app.use('/api/products', require('./routes/products'));
// app.use('/api/recipes', require('./routes/recipes'));
// app.use('/api/purchases', require('./routes/purchases'));
// app.use('/api/inventory', require('./routes/inventory'));

app.get('/api/health', (_req, res) => {
  const counts = ['ingredients', 'products', 'recipes', 'suppliers', 'purchases']
    .reduce((acc, t) => {
      acc[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
      return acc;
    }, {});
  res.json({ status: 'OK', db: db.dbPath, counts });
});

// --- static back-office UI ---
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    }
  }
}));

app.get('/health', (_req, res) => res.json({ status: 'OK' }));

const PORT = Number(process.env.PORT || 3100);
app.listen(PORT, () => {
  console.log(`🚀 thumbaz_8newlight back-office at http://localhost:${PORT}`);
  console.log(`📦 db: ${db.dbPath}`);
});
