const db = require('./db');
console.log('📊 Analyzing current data structure...\n');

// What exists now
const counts = {
  ingredients: db.prepare('SELECT COUNT(*) AS n FROM ingredients WHERE active=1').get().n,
  products: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1').get().n,
  recipes: db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n,
  purchases: db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n,
  transactions: db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,
  users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE active=1').get().n,
  expenses: db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n,
  inventory: db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE quantity_base > 0').get().n,
};

console.log('Current data:');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);

// List ingredients
console.log('\nActive ingredients:');
db.prepare('SELECT id, name, category, base_unit, conv_purchase_to_base, last_purchase_price FROM ingredients WHERE active=1 ORDER BY category, name').all().forEach(i => {
  console.log(`  [${i.id}] ${i.name} (${i.category}) ${i.base_unit} conv:${i.conv_purchase_to_base} price:${i.last_purchase_price}`);
});

// List products  
console.log('\nActive products:');
db.prepare('SELECT p.id, p.name, p.category, p.variant, (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price, (SELECT COUNT(*) FROM recipes r WHERE r.product_id=p.id) AS rec_count FROM products p WHERE p.active=1 ORDER BY p.name').all().forEach(p => {
  console.log(`  [${p.id}] ${p.name} ${p.variant||''} (${p.category}) Rp ${p.price} recipes:${p.rec_count}`);
});

// Check recipe coverage
console.log('\nProducts WITHOUT recipes:');
db.prepare('SELECT p.name, p.is_resale FROM products p LEFT JOIN recipes r ON r.product_id=p.id WHERE r.product_id IS NULL AND p.active=1 AND p.is_resale=0').all().forEach(p => {
  console.log(`  ⚠ ${p.name} — no recipe, needs resale toggle or recipe`);
});

// Check ingredient categories
console.log('\nIngredient categories:');
db.prepare('SELECT id, name, (SELECT COUNT(*) FROM ingredients WHERE LOWER(category)=LOWER(ic.name)) AS cnt FROM ingredient_categories ic ORDER BY name').all().forEach(c => {
  console.log(`  ${c.name}: ${c.cnt} ingredients`);
});

// Foreign key integrity
console.log('\nForeign key checks:');
const fks = [
  ['recipes → products','SELECT COUNT(*) AS n FROM recipes r LEFT JOIN products p ON p.id=r.product_id WHERE p.id IS NULL'],
  ['recipes → ingredients','SELECT COUNT(*) AS n FROM recipes r LEFT JOIN ingredients i ON i.id=r.ingredient_id WHERE i.id IS NULL'],
  ['purchase_items → purchases','SELECT COUNT(*) AS n FROM purchase_items pi LEFT JOIN purchases p ON p.id=pi.purchase_id WHERE p.id IS NULL'],
  ['purchase_items → ingredients','SELECT COUNT(*) AS n FROM purchase_items pi LEFT JOIN ingredients i ON i.id=pi.ingredient_id WHERE i.id IS NULL'],
  ['transaction_items → products','SELECT COUNT(*) AS n FROM transaction_items ti LEFT JOIN products p ON p.id=ti.product_id WHERE p.id IS NULL'],
];
fks.forEach(([label,sql]) => {
  const r = db.prepare(sql).get();
  console.log(`  ${label}: ${r.n} orphans ${r.n > 0 ? '⚠' : '✓'}`);
});

console.log('\n✅ Analysis complete');
