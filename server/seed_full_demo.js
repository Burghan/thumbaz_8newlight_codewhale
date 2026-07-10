const db = require('./db');
console.log('🌱 Seeding FULL demo data (June + July 2026)...\n');

// ═══ HELPERS ═══
function purchase(ingName, qty, cost, date) {
  const ing = db.prepare('SELECT id, base_unit, purchase_unit, conv_purchase_to_base FROM ingredients WHERE LOWER(name) = LOWER(?)').get(ingName);
  if (!ing) { console.log(`  ⚠ ${ingName} not found`); return; }
  const conv = Number(ing.conv_purchase_to_base) || 1;
  const baseQty = qty * conv;
  const unitPrice = Math.round(cost / qty);
  const costMicro = baseQty > 0 ? Math.round((cost / baseQty) * 1e6) : 0;

  const p = db.prepare("INSERT INTO purchases (purchased_at) VALUES (?)").run(date);
  db.prepare("INSERT INTO purchase_items (purchase_id, ingredient_id, purchase_qty, purchase_unit, base_qty, unit_price, line_total) VALUES (?,?,?,?,?,?,?)")
    .run(p.lastInsertRowid, ing.id, qty, ing.purchase_unit || ing.base_unit, baseQty, unitPrice, cost);

  db.prepare("INSERT INTO inventory (ingredient_id, quantity_base, avg_cost_micro) VALUES (?,?,?) ON CONFLICT(ingredient_id) DO UPDATE SET quantity_base = quantity_base + ?, avg_cost_micro = ?")
    .run(ing.id, baseQty, costMicro, baseQty, costMicro);

  db.prepare("INSERT INTO stock_movements (ingredient_id, type, qty_base, unit_cost_micro, ref_type, ref_id, note) VALUES (?,'purchase',?,?,'purchase',?,?)")
    .run(ing.id, baseQty, costMicro, p.lastInsertRowid, `Purchase: ${ingName}`);

  db.prepare("UPDATE ingredients SET last_purchase_price = ?, updated_at = datetime('now') WHERE id = ?").run(unitPrice, ing.id);
}

function sale(productName, qty, date) {
  const prod = db.prepare("SELECT p.id, (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price FROM products p WHERE LOWER(p.name) = LOWER(?)").get(productName);
  if (!prod || !prod.price) return;
  const line = qty * prod.price;
  const t = db.prepare("INSERT INTO transactions (transacted_at, payment_method) VALUES (?,'cash')").run(date);
  db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)").run(t.lastInsertRowid, prod.id, qty, prod.price, line);
}

function expense(date, cat, desc, amt) {
  db.prepare("INSERT INTO expenses (date, category, description, amount) VALUES (?,?,?,?)").run(date, cat, desc, amt);
}

const tx = db.transaction(() => {

// ═══ 1. JUNE PURCHASES (89 records for all 44 ingredients) ═══
console.log('📦 June Purchases...');
const ings = db.prepare('SELECT name, last_purchase_price, conv_purchase_to_base FROM ingredients WHERE active = 1 ORDER BY name').all();
let purchaseCount = 0;
ings.forEach((ing, i) => {
  const price = ing.last_purchase_price || 50000;
  const qty = Math.max(1, Math.round((ing.conv_purchase_to_base || 100) / 10));
  // Purchases on early June
  purchase(ing.name, qty, price * qty, `2026-06-0${1 + (i % 5)}`);
  purchaseCount++;
  // Restock for 1/3 of ingredients
  if (i % 3 === 0) {
    purchase(ing.name, Math.round(qty * 1.5), Math.round(price * qty * 1.5), '2026-06-15');
    purchaseCount++;
  }
});
console.log(`  ✅ ${purchaseCount} purchase records`);

// ═══ 2. JUNE SALES (20 business days) ═══
console.log('💰 June Sales...');
const products = db.prepare("SELECT p.name, (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price FROM products p WHERE p.active = 1").all().filter(p => p.price);
const coffeeProds = products.filter(p => ['Americano','Latte','Spanish Latte','Cappuccino','NewLight Latte'].some(c => p.name.includes(c)));
const foodProds = products.filter(p => ['Croissant','French Fries','Classic Beef','Brownies'].some(c => p.name.includes(c)));
const otherProds = products.filter(p => !coffeeProds.includes(p) && !foodProds.includes(p));

const juneDays = [];
for (let d = 1; d <= 30; d++) {
  const dow = new Date(2026, 5, d).getDay();
  if (dow >= 1 && dow <= 6) juneDays.push(`2026-06-${String(d).padStart(2, '0')}`);
}

juneDays.forEach(date => {
  const dayNum = parseInt(date.slice(8));
  const isSat = [6, 13, 20, 27].includes(dayNum);
  const txns = isSat ? 3 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 8);

  for (let t = 0; t < txns; t++) {
    // 50% coffee, 30% food, 20% other
    const r = Math.random();
    const pool = r < 0.5 ? coffeeProds : (r < 0.8 ? foodProds : otherProds);
    const prod = pool[Math.floor(Math.random() * pool.length)];
    sale(prod.name, Math.floor(Math.random() * 3) + 1, date);
  }
});
const juneTxns = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE transacted_at LIKE '2026-06%'").get().n;
console.log(`  ✅ ${juneTxns} June transactions`);

// ═══ 3. JUNE EXPENSES ═══
console.log('💸 June Expenses...');
[
  ['2026-06-01','Rent','Monthly rent',3000000],['2026-06-02','Utilities','Electricity',520000],
  ['2026-06-05','Supplies','Cleaning supplies',150000],['2026-06-08','Marketing','Social media ads',300000],
  ['2026-06-12','Maintenance','AC service',400000],['2026-06-15','Utilities','Internet',350000],
  ['2026-06-20','Supplies','Paper bags stock',250000],['2026-06-25','Other','Staff meals',200000],
].forEach(([d,c,desc,a]) => expense(d,c,desc,a));
console.log('  ✅ 8 expenses');

// ═══ 4. JUNE ATTENDANCE ═══
console.log('👥 June Attendance...');
const users = db.prepare('SELECT id, name FROM users WHERE active = 1').all();
juneDays.forEach(date => {
  users.forEach(u => {
    const isSat = [6, 13, 20, 27].includes(parseInt(date.slice(8)));
    db.prepare("INSERT INTO attendances (employee_name, clock_in, clock_out, user_id) VALUES (?,?,?,?)")
      .run(u.name, `${date}T08:00:00`, `${date}T${isSat?'14':'16'}:00:00`, u.id);
  });
});
console.log(`  ✅ ${juneDays.length * users.length} attendance records`);

}); // end transaction

try {
  tx();
  console.log('\n🎉 Demo data seeded!');
  console.log(`  Transactions: ${db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n}`);
  console.log(`  Revenue: Rp ${(db.prepare('SELECT SUM(line_total) AS r FROM transaction_items').get().r || 0).toLocaleString('id-ID')}`);
} catch(e) {
  console.error('❌', e.message);
}
