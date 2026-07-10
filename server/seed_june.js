const db = require('./db');
console.log('🌱 Seeding JUNE 2026 demo data (relationally correct)...\n');

// ═══ Helper: safe purchase recording ═══
function purchase(ingName, qty, cost, date, suppId) {
  const ing = db.prepare('SELECT id, name, base_unit, purchase_unit, conv_purchase_to_base FROM ingredients WHERE name = ? AND active = 1').get(ingName);
  if (!ing) { console.log(`  ⚠ Skipped "${ingName}" — ingredient not found`); return; }
  const conv = Number(ing.conv_purchase_to_base) || 1;
  const baseQty = qty * conv;
  const unitPrice = Math.round(cost / qty);
  const costMicro = baseQty > 0 ? Math.round((cost / baseQty) * 1e6) : 0;

  const p = db.prepare("INSERT INTO purchases (supplier_id, purchased_at) VALUES (?,?)").run(suppId || null, date);
  const pid = p.lastInsertRowid;

  db.prepare("INSERT INTO purchase_items (purchase_id, ingredient_id, purchase_qty, purchase_unit, base_qty, unit_price, line_total) VALUES (?,?,?,?,?,?,?)")
    .run(pid, ing.id, qty, ing.purchase_unit || ing.base_unit, baseQty, unitPrice, cost);

  // Update inventory
  db.prepare("INSERT INTO inventory (ingredient_id, quantity_base, avg_cost_micro) VALUES (?,?,?) ON CONFLICT(ingredient_id) DO UPDATE SET quantity_base = quantity_base + ?, avg_cost_micro = ?, updated_at = datetime('now')")
    .run(ing.id, baseQty, costMicro, baseQty, costMicro);

  // Stock movement
  db.prepare("INSERT INTO stock_movements (ingredient_id, type, qty_base, unit_cost_micro, ref_type, ref_id, note) VALUES (?,'purchase',?,?,'purchase',?,?)")
    .run(ing.id, baseQty, costMicro, pid, `Jun purchase: ${ingName}`);

  // Update ingredient price
  db.prepare("UPDATE ingredients SET last_purchase_price = ?, updated_at = datetime('now') WHERE id = ?").run(unitPrice, ing.id);
}

function sale(productName, qty, date, payment) {
  const prod = db.prepare("SELECT p.id, (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price FROM products p WHERE p.name = ? AND p.active = 1").get(productName);
  if (!prod || !prod.price) { console.log(`  ⚠ Skipped "${productName}" — no product or price`); return; }
  const line = qty * prod.price;

  const t = db.prepare("INSERT INTO transactions (transacted_at, payment_method, reference) VALUES (?,?,'')").run(date, payment || 'cash');
  db.prepare("INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale) VALUES (?,?,?,?,?,0)").run(t.lastInsertRowid, prod.id, qty, prod.price, line);
}

function expense(date, cat, desc, amt) {
  db.prepare("INSERT INTO expenses (date, category, description, amount) VALUES (?,?,?,?)").run(date, cat, desc, amt);
}

function attendance(name, uid, date, inTime, outTime) {
  db.prepare("INSERT INTO attendances (employee_name, clock_in, clock_out, user_id) VALUES (?,?,?,?)").run(name, `${date}T${inTime}`, `${date}T${outTime}`, uid);
}

console.log('Building June 2026 data...\n');

const tx = db.transaction(() => {

// ═══ 1. JUNE PURCHASES (for all active ingredients) ═══
console.log('📦 June Purchases...');
const ings = db.prepare('SELECT id, name, last_purchase_price, conv_purchase_to_base, purchase_unit FROM ingredients WHERE active = 1 ORDER BY category, name').all();
ings.forEach((ing, i) => {
  const price = (ing.last_purchase_price || 50000);
  const qty = Math.max(1, Math.round(ing.conv_purchase_to_base / 10) || 2);
  // Purchase early June
  purchase(ing.name, qty, price * qty, '2026-06-0' + (1 + (i % 5)), 1);
  // Restock mid June
  if (i % 3 === 0) purchase(ing.name, Math.round(qty * 1.5), Math.round(price * qty * 1.5), '2026-06-15', 1);
});
console.log(`  ✅ ${ings.length * 2 - Math.floor(ings.length/3)} purchases for ${ings.length} ingredients`);

// ═══ 2. JUNE SALES (20 business days, Mon-Sat) ═══
console.log('💰 June Sales...');
const products = db.prepare("SELECT p.id, p.name, (SELECT price FROM product_prices pp WHERE pp.product_id=p.id AND pp.effective_to IS NULL ORDER BY pp.id DESC LIMIT 1) AS price FROM products p WHERE p.active = 1 AND p.id IS NOT NULL").all();
const topProds = products.filter(p => p.price >= 12000);
const allProds = products.filter(p => p.id IS NOT NULL);

const juneBusinessDays = [];
for (let day = 1; day <= 30; day++) {
  const d = new Date(2026, 5, day); // June = month 5
  const dow = d.getDay();
  if (dow >= 1 && dow <= 6) juneBusinessDays.push(`2026-06-${String(day).padStart(2, '0')}`);
}

juneBusinessDays.forEach(date => {
  const dayNum = parseInt(date.slice(8));
  const isWeekend = [6, 13, 20, 27].includes(dayNum); // Saturdays
  const txns = isWeekend ? 3 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 8);
  
  for (let t = 0; t < txns; t++) {
    const prod = Math.random() < 0.6 ? topProds[Math.floor(Math.random() * topProds.length)] : allProds[Math.floor(Math.random() * allProds.length)];
    const qty = Math.floor(Math.random() * 3) + 1;
    const payment = Math.random() < 0.5 ? 'cash' : (Math.random() < 0.7 ? 'qris' : 'transfer');
    sale(prod.name, qty, date, payment);
  }
});
console.log(`  ✅ ~${juneBusinessDays.length * 6} transactions across 24 business days`);

// ═══ 3. JUNE EXPENSES ═══
console.log('💸 June Expenses...');
const junExpenses = [
  ['2026-06-01', 'Rent', 'Monthly rent', 3000000],
  ['2026-06-02', 'Utilities', 'Electricity May', 520000],
  ['2026-06-05', 'Supplies', 'Cleaning + tissue', 150000],
  ['2026-06-08', 'Marketing', 'Social media ads', 300000],
  ['2026-06-12', 'Maintenance', 'AC service', 400000],
  ['2026-06-15', 'Utilities', 'Internet', 350000],
  ['2026-06-18', 'Supplies', 'Paper cups stock', 250000],
  ['2026-06-22', 'Marketing', 'Flyers printing', 180000],
  ['2026-06-25', 'Maintenance', 'Plumbing repair', 275000],
  ['2026-06-28', 'Other', 'Staff meal allowance', 200000],
];
junExpenses.forEach(([d, c, desc, a]) => expense(d, c, desc, a));
console.log(`  ✅ ${junExpenses.length} expenses (Rp ${junExpenses.reduce((s, e) => s + e[3], 0).toLocaleString('id-ID')})`);

// ═══ 4. JUNE ATTENDANCE ═══
console.log('👥 June Attendance...');
const users = db.prepare('SELECT id, name FROM users WHERE active = 1').all();
juneBusinessDays.forEach(date => {
  users.forEach(u => {
    const isSat = [6, 13, 20, 27].includes(parseInt(date.slice(8)));
    const inTime = '08:00:00';
    const outTime = isSat ? '14:00:00' : '16:00:00';
    // Occasionally late
    const late = Math.random() < 0.1;
    attendance(u.name, u.id, date, late ? '08:' + String(15 + Math.floor(Math.random()*30)).padStart(2, '0') + ':00' : inTime, outTime);
  });
});
console.log(`  ✅ ${juneBusinessDays.length * users.length} attendance records`);

// ═══ 5. JUNE PAYROLL ═══
console.log('💰 June Payroll...');
users.forEach(u => {
  db.prepare("INSERT OR REPLACE INTO payroll (user_id, month, overtime, bonus, deduction) VALUES (?, '2026-06', ?, ?, 0)").run(u.id, u.id === 2 ? 80000 : 50000, 30000);
});
console.log(`  ✅ Payroll for ${users.length} users`);

}); // end transaction

try {
  tx();
  console.log('\n🎉 June 2026 demo data seeded successfully!');
  
  // Verify
  console.log('\n📊 Final state:');
  const stats = [
    ['Products', 'SELECT COUNT(*) AS n FROM products WHERE active=1'],
    ['Ingredients', 'SELECT COUNT(*) AS n FROM ingredients WHERE active=1'],
    ['Recipes', 'SELECT COUNT(*) AS n FROM recipes'],
    ['Purchases (Jun)', "SELECT COUNT(*) AS n FROM purchases WHERE purchased_at LIKE '2026-06%'"],
    ['Transactions (Jun)', "SELECT COUNT(*) AS n FROM transactions WHERE transacted_at LIKE '2026-06%'"],
    ['Transaction items', "SELECT COUNT(*) AS n FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id WHERE t.transacted_at LIKE '2026-06%'"],
    ['Expenses (Jun)', "SELECT COUNT(*) AS n FROM expenses WHERE date LIKE '2026-06%'"],
    ['Inventory w/ stock', 'SELECT COUNT(*) AS n FROM inventory WHERE quantity_base > 0'],
    ['Stock movements', 'SELECT COUNT(*) AS n FROM stock_movements'],
  ];
  stats.forEach(([label, sql]) => {
    console.log(`  ${label}: ${db.prepare(sql).get().n}`);
  });
} catch(e) {
  console.error('❌ ERROR:', e.message);
}
