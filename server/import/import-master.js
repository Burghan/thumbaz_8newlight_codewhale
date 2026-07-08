// Reconcile + import master data from Menu-Ingredient-Receipe.xlsx.
//
//   node server/import/import-master.js [--file data/Menu-Ingredient-Receipe.xlsx] [--apply]
//
// Default is DRY RUN: it matches everything by normalized name and prints a
// reconciliation report without touching the database. Pass --apply to write.
const path = require('path');
const db = require('../db');
const runMigrations = require('../migrate');
const { loadWorkbook, readSheet, normName, normUnit } = require('../lib/xlsx');

// Recipe product name (normalized) -> menu product name (normalized).
// Resolves the 3 variant/synonym mismatches; base recipes attach to the Regular variant.
const PRODUCT_OVERRIDES = {
  'americano cold': 'americano ice',
  'midnight dirty': 'midnight dirty - regular',
  'spanish latte': 'spanish latte - regular'
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const FILE = path.resolve(arg('--file', 'data/Menu-Ingredient-Receipe.xlsx'));
const APPLY = process.argv.includes('--apply');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function build() {
  const wb = await loadWorkbook(FILE);

  // --- Ingredients master ---
  const ingRows = readSheet(wb.getWorksheet('Ingredients'));
  const ingredients = ingRows.map(r => {
    const name = r['Nama Bahan Baku'];
    const baseUnit = normUnit(r['Ingredient_unit']);
    const price = num(r['Harga Beli Terakhir (Rp)']);
    const pkg = num(r['Volume/Isi Kemasan']);
    const costPerBase = pkg > 0 ? price / pkg : 0; // rupiah per base unit
    return {
      name, key: normName(name),
      category: r['Ingredients Category'] || null,
      base_unit: baseUnit,
      purchase_unit: 'pack',
      conv_purchase_to_base: pkg || null,
      last_price: price,
      std_cost_per_base: costPerBase,
      std_cost_per_base_micro: Math.round(costPerBase * 1e6)
    };
  }).filter(i => i.key);
  const ingByKey = new Map(ingredients.map(i => [i.key, i]));

  // --- Product menu ---
  const menuRows = readSheet(wb.getWorksheet('Product_Menu'));
  const products = menuRows.map(r => ({
    name: (r['Menu_name'] || '').toString().trim(),
    key: normName(r['Menu_name']),
    category: r['Product_Category'] || null,
    price: num(r['price']),
    labor_cost: num(r['labor_cost']),
    utility_cost: num(r['utility_cost']),
    packaging_cost: num(r['wifi_cost']),
    std_cost_per_item: num(r['std_cost_per_item']),
    active: num(r['active']) === 1 ? 1 : (r['active'] == null ? 1 : 0)
  })).filter(p => p.key);
  const prodByKey = new Map(products.map(p => [p.key, p]));

  // --- Recipe lines ---
  const recRows = readSheet(wb.getWorksheet('Receipe'));
  const recipes = recRows.map(r => ({
    product_name: (r['product_name'] || '').toString().trim(),
    product_key: normName(r['product_name']),
    ingredient_name: (r['ingredient_name'] || '').toString().trim(),
    ingredient_key: normName(r['ingredient_name']),
    quantity: num(r['quantity']),
    base_unit: normUnit(r['base_unit'])
  })).filter(r => r.product_key && r.ingredient_key);

  return { ingredients, ingByKey, products, prodByKey, recipes };
}

// Match a recipe product name to a menu product: exact, else unique prefix.
function matchProduct(recipeKey, prodByKey) {
  if (prodByKey.has(recipeKey)) return { key: recipeKey, how: 'exact' };
  const prefixed = [...prodByKey.keys()].filter(k => k.startsWith(recipeKey + ' ') || k.startsWith(recipeKey + ' -'));
  if (prefixed.length === 1) return { key: prefixed[0], how: 'prefix' };
  if (prefixed.length > 1) return { key: null, how: 'ambiguous', candidates: prefixed };
  return { key: null, how: 'unmatched' };
}

async function main() {
  const { ingredients, ingByKey, products, prodByKey, recipes } = await build();

  console.log(`FILE: ${FILE}`);
  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  console.log(`Ingredients master : ${ingredients.length}`);
  console.log(`Menu products      : ${products.length}`);
  console.log(`Recipe lines       : ${recipes.length}\n`);

  // Ingredient reconciliation
  const missingIng = [...new Set(recipes.filter(r => !ingByKey.has(r.ingredient_key)).map(r => r.ingredient_name))];
  const noCost = ingredients.filter(i => i.std_cost_per_base <= 0).map(i => i.name);
  console.log(`Recipe ingredients missing from master (${missingIng.length}): would be AUTO-CREATED with cost 0`);
  missingIng.forEach(n => console.log('   +', n));
  console.log(`\nMaster ingredients with no cost (${noCost.length}):`);
  noCost.forEach(n => console.log('   ~', n));

  // Product reconciliation for recipes
  const recProducts = [...new Set(recipes.map(r => r.product_key))];
  const prodMatch = {};
  recProducts.forEach(k => { prodMatch[k] = matchProduct(k, prodByKey); });
  const exact = recProducts.filter(k => prodMatch[k].how === 'exact');
  const prefix = recProducts.filter(k => prodMatch[k].how === 'prefix');
  const ambiguous = recProducts.filter(k => prodMatch[k].how === 'ambiguous');
  const unmatched = recProducts.filter(k => prodMatch[k].how === 'unmatched');
  const nameOf = (key) => recipes.find(r => r.product_key === key).product_name;

  console.log(`\nRecipe→Menu product matching (${recProducts.length} recipe products):`);
  console.log(`   exact  : ${exact.length}`);
  console.log(`   prefix : ${prefix.length}` + (prefix.length ? '  ->  ' + prefix.map(k => `${nameOf(k)} ⇒ ${prodMatch[k].key}`).join(' | ') : ''));
  console.log(`   AMBIGUOUS (${ambiguous.length}): ${ambiguous.map(k => `${nameOf(k)} ⇒ [${prodMatch[k].candidates.join(', ')}]`).join(' | ') || '-'}`);
  console.log(`   UNMATCHED (${unmatched.length}): ${unmatched.map(nameOf).join(', ') || '-'}`);

  const menuNoRecipe = products.filter(p => !recProducts.some(k => (prodMatch[k].key || k) === p.key));
  console.log(`\nMenu products with NO recipe (${menuNoRecipe.length}): ${menuNoRecipe.map(p => p.name).join(', ')}`);

  if (!APPLY) {
    console.log('\n--- DRY RUN: nothing written. Re-run with --apply once mappings look right. ---');
    return;
  }

  const result = applyImport({ ingredients, products, recipes });
  console.log('\n=== APPLIED ===');
  console.log(`ingredients written : ${result.ingCount} (incl. ${result.autoCreated} auto-created @ cost 0)`);
  console.log(`products written    : ${result.prodCount}`);
  console.log(`recipe links written: ${result.linked}` + (result.skippedProd ? ` (skipped ${result.skippedProd} — unresolved product)` : ''));
  if (result.unresolvedProducts.length) console.log('unresolved products :', result.unresolvedProducts.join(', '));

  // COGS sanity check from the imported recipes
  const cogs = db.prepare(`
    SELECT p.name,
           ROUND(SUM(r.quantity * i.std_cost_per_base_micro) / 1e6) AS cogs_rp,
           COUNT(*) AS ingredients
    FROM recipes r
    JOIN ingredients i ON i.id = r.ingredient_id
    JOIN products p ON p.id = r.product_id
    GROUP BY p.id ORDER BY p.name LIMIT 8
  `).all();
  console.log('\nSample recipe COGS (Rp):');
  cogs.forEach(c => console.log(`   ${c.name}: ${c.cogs_rp} (${c.ingredients} ingredients)`));
}

function applyImport({ ingredients, products, recipes }) {
  runMigrations();
  const tx = db.transaction(() => {
    // Fresh, deterministic import (FK-safe delete order).
    db.exec('DELETE FROM recipes; DELETE FROM product_prices; DELETE FROM inventory; DELETE FROM products; DELETE FROM ingredients;');

    const insIng = db.prepare(`INSERT INTO ingredients
      (name, category, base_unit, purchase_unit, conv_purchase_to_base, last_purchase_price, std_cost_per_base_micro, active)
      VALUES (?,?,?,?,?,?,?,1)`);
    const keyToIngId = new Map();
    for (const i of ingredients) {
      const r = insIng.run(i.name, i.category, i.base_unit || 'pcs', i.purchase_unit, i.conv_purchase_to_base,
        i.last_price ? Math.round(i.last_price) : null, i.std_cost_per_base_micro);
      keyToIngId.set(i.key, r.lastInsertRowid);
    }

    // Auto-create recipe ingredients missing from the master (cost 0), unit from the recipe line.
    const missing = new Map();
    for (const rec of recipes) {
      if (!keyToIngId.has(rec.ingredient_key) && !missing.has(rec.ingredient_key)) {
        missing.set(rec.ingredient_key, { name: rec.ingredient_name, base_unit: rec.base_unit || 'pcs' });
      }
    }
    for (const [key, m] of missing) {
      const r = insIng.run(m.name, null, m.base_unit || 'pcs', null, null, null, 0);
      keyToIngId.set(key, r.lastInsertRowid);
    }

    // Opening inventory rows (0 stock) so purchasing works later.
    const insInv = db.prepare(`INSERT INTO inventory (ingredient_id, quantity_base, avg_cost_micro) VALUES (?,0,?)`);
    for (const i of ingredients) insInv.run(keyToIngId.get(i.key), i.std_cost_per_base_micro);
    for (const key of missing.keys()) insInv.run(keyToIngId.get(key), 0);

    // Products + current price.
    const insProd = db.prepare(`INSERT INTO products
      (name, category, variant, labor_cost, utility_cost, packaging_cost, active) VALUES (?,?,?,?,?,?,?)`);
    const insPrice = db.prepare(`INSERT INTO product_prices (product_id, price) VALUES (?,?)`);
    const keyToProdId = new Map();
    for (const p of products) {
      const r = insProd.run(p.name, p.category, null, Math.round(p.labor_cost), Math.round(p.utility_cost), Math.round(p.packaging_cost), p.active);
      keyToProdId.set(p.key, r.lastInsertRowid);
      if (p.price > 0) insPrice.run(r.lastInsertRowid, Math.round(p.price));
    }

    // Recipes (apply the 3 product overrides).
    const insRec = db.prepare(`INSERT INTO recipes (product_id, ingredient_id, quantity)
      VALUES (?,?,?) ON CONFLICT(product_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity`);
    let linked = 0, skippedProd = 0;
    const unresolvedProducts = new Set();
    for (const rec of recipes) {
      const prodKey = PRODUCT_OVERRIDES[rec.product_key] || rec.product_key;
      const pid = keyToProdId.get(prodKey);
      const iid = keyToIngId.get(rec.ingredient_key);
      if (!pid) { skippedProd++; unresolvedProducts.add(rec.product_name); continue; }
      insRec.run(pid, iid, rec.quantity);
      linked++;
    }

    return { ingCount: keyToIngId.size, autoCreated: missing.size, prodCount: keyToProdId.size, linked, skippedProd, unresolvedProducts: [...unresolvedProducts] };
  });
  return tx();
}

main().catch(e => { console.error(e); process.exit(1); });
