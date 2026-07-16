const express = require('express');
const db = require('../db');
const { microToRupiah } = require('../lib/money');

const router = express.Router();

// Read-only ingredient list for the POS custom-item recipe builder. The full
// /api/ingredients route is manager-gated; the POS (staff) only needs a minimal,
// safe subset to pick ingredients and show cost, so this is exposed to POS roles.
router.get('/', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, base_unit, std_cost_per_base_micro FROM ingredients WHERE active = 1 ORDER BY name'
  ).all();
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    base_unit: r.base_unit,
    std_cost_per_base: microToRupiah(r.std_cost_per_base_micro)
  })));
});

module.exports = router;
