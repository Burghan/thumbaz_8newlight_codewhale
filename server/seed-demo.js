const db = require('./db');
const { scryptSync } = require('crypto');

console.log('🌱 Seeding demo data for 1-month coffee shop operation...\n');

const tx = db.transaction(() => {

// ═══ 1. USERS ═══
db.prepare("DELETE FROM users WHERE id > 1");
db.prepare("INSERT OR REPLACE INTO users (id,name,role,pin_hash,rate,phone,active) VALUES (1,'Burghan','admin',?,0,null,1)").run(scryptSync('0000','salt',64).toString('hex'));
db.prepare("INSERT INTO users (name,role,pin_hash,rate,phone,active) VALUES ('Irham','manager',?,70000,'0812',1)").run(scryptSync('1111','salt',64).toString('hex'));
db.prepare("INSERT INTO users (name,role,pin_hash,rate,phone,active) VALUES ('Indah','staff',?,70000,'0813',1)").run(scryptSync('2222','salt',64).toString('hex'));
db.prepare("INSERT INTO users (name,role,pin_hash,rate,phone,active) VALUES ('Natasya','staff',?,70000,'0814',1)").run(scryptSync('3333','salt',64).toString('hex'));
console.log('✅ 4 users created');

// ═══ 2. INGREDIENTS ═══
const ings = [
  ['Espresso Beans','Drink','g','kg',1000,180000],
  ['Fresh Milk','Drink','ml','liter',1000,25000],
  ['Sugar Syrup','Drink','ml','btl',700,35000],
  ['Ice Cube','Drink','g','pack',5000,15000],
  ['Mineral Water','Drink','ml','galon',19000,25000],
  ['Croissant','Food','pcs','box',12,72000],
  ['Cup 12oz','Packaging','pcs','pack',50,25000],
  ['Lid','Packaging','pcs','pack',100,15000],
];
ings.forEach(([name,cat,bu,pu,conv,price]) => {
  const costMicro = Math.round((price/conv)*1e6);
  db.prepare(`INSERT INTO ingredients (name,category,base_unit,purchase_unit,conv_purchase_to_base,last_purchase_price,std_cost_per_base_micro,min_stock,active) VALUES (?,?,?,?,?,?,?,10,1)`)
    .run(name,cat,bu,pu,conv,price,costMicro);
  // Create inventory row
  db.prepare('INSERT OR IGNORE INTO inventory (ingredient_id,quantity_base,avg_cost_micro) VALUES (last_insert_rowid(),0,0)');
});
console.log('✅ 8 ingredients with prices');

// ═══ 3. PRODUCT CATEGORIES ═══
['Coffee','Non-Coffee','Food','Snack'].forEach(c => {
  db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)').run(c);
});

// ═══ 4. PRODUCTS ═══
const products = [
  ['Americano Hot','Coffee','Regular',15000,0,0,1000],
  ['Latte Hot','Coffee','Regular',18000,0,0,1500],
  ['Spanish Latte','Coffee','Regular',22000,0,0,2000],
  ['Cappuccino','Coffee','Regular',18000,0,0,1500],
  ['Choco Ice','Non-Coffee','Regular',18000,0,0,2000],
  ['Croissant','Food','',12000,0,0,1000],
  ['Mineral Water','Drink','',6000,0,0,0],
  ['Ice Americano','Coffee','Regular',18000,0,0,1500],
];
products.forEach(([name,cat,var_,price,lab,util,pkg]) => {
  db.prepare('INSERT INTO products (name,category,variant,labor_cost,utility_cost,packaging_cost,active) VALUES (?,?,?,?,?,?,1)').run(name,cat,var_,lab,util,pkg);
  db.prepare('INSERT INTO product_prices (product_id,price) VALUES (last_insert_rowid(),?)').run(price);
});
console.log('✅ 8 products with prices');

// ═══ 5. RECIPES ═══
const prodMap = {}; db.prepare('SELECT id,name FROM products').all().forEach(p=>prodMap[p.name]=p.id);
const ingMap = {}; db.prepare('SELECT id,name FROM ingredients').all().forEach(i=>ingMap[i.name]=i.id);
const recipes = [
  ['Americano Hot','Espresso Beans',16],['Americano Hot','Mineral Water',120],
  ['Latte Hot','Espresso Beans',16],['Latte Hot','Fresh Milk',200],
  ['Spanish Latte','Espresso Beans',16],['Spanish Latte','Fresh Milk',180],['Spanish Latte','Sugar Syrup',15],
  ['Cappuccino','Espresso Beans',16],['Cappuccino','Fresh Milk',150],
  ['Choco Ice','Fresh Milk',200],['Choco Ice','Sugar Syrup',30],['Choco Ice','Ice Cube',100],
  ['Croissant','Croissant',1],
  ['Ice Americano','Espresso Beans',18],['Ice Americano','Mineral Water',100],['Ice Americano','Ice Cube',100],
];
recipes.forEach(([prod,ing,qty]) => {
  db.prepare('INSERT INTO recipes (product_id,ingredient_id,quantity) VALUES (?,?,?)').run(prodMap[prod],ingMap[ing],qty);
});
console.log('✅ 16 recipe lines');

// ═══ 6. PURCHASES (update inventory + last_price) ═══
function recordPurchase(ingName, qty, cost, date) {
  const ing = db.prepare('SELECT id,base_unit,purchase_unit,conv_purchase_to_base FROM ingredients WHERE name=?').get(ingName);
  if(!ing) return;
  const conv = ing.conv_purchase_to_base||1;
  const baseQty = qty * conv;
  const unitPrice = Math.round(cost/qty);
  const costMicro = Math.round((cost/baseQty)*1e6);
  
  const p = db.prepare("INSERT INTO purchases (purchased_at) VALUES (?)").run(date);
  const pid = p.lastInsertRowid;
  db.prepare("INSERT INTO purchase_items (purchase_id,ingredient_id,purchase_qty,purchase_unit,base_qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?)").run(pid, ing.id, qty, ing.purchase_unit, baseQty, unitPrice, cost);
  
  // Update inventory
  db.prepare("INSERT INTO inventory (ingredient_id,quantity_base,avg_cost_micro) VALUES (?,?,?) ON CONFLICT(ingredient_id) DO UPDATE SET quantity_base=quantity_base+?, avg_cost_micro=?, updated_at=datetime('now')").run(ing.id, baseQty, costMicro, baseQty, costMicro);
  // Stock movement
  db.prepare("INSERT INTO stock_movements (ingredient_id,type,qty_base,unit_cost_micro,ref_type,ref_id,note) VALUES (?,'purchase',?,?,'purchase',?,?)").run(ing.id, baseQty, costMicro, pid, `Purchase ${date}`);
  // Update ingredient last_price
  db.prepare("UPDATE ingredients SET last_purchase_price=?, updated_at=datetime('now') WHERE id=?").run(unitPrice, ing.id);
}

recordPurchase('Espresso Beans',5,900000,'2026-07-01');
recordPurchase('Fresh Milk',10,250000,'2026-07-01');
recordPurchase('Sugar Syrup',5,175000,'2026-07-01');
recordPurchase('Ice Cube',3,45000,'2026-07-01');
recordPurchase('Mineral Water',2,50000,'2026-07-01');
recordPurchase('Croissant',4,288000,'2026-07-01');
recordPurchase('Cup 12oz',3,75000,'2026-07-01');
recordPurchase('Lid',3,45000,'2026-07-01');
recordPurchase('Espresso Beans',3,540000,'2026-07-15');
recordPurchase('Fresh Milk',5,125000,'2026-07-15');
console.log('✅ 10 purchases → inventory updated');

// ═══ 7. SALES (30 days) ═══
const dailySales = [
  4,5,3,2,6,7,4,8,5,3,9,5,2,6,7,4,8,6,3,5,9,4,2,7,6,5,8,4,3,6
];
let totalRevenue = 0;
const sellProducts = ['Americano Hot','Latte Hot','Spanish Latte','Cappuccino','Choco Ice','Croissant','Mineral Water','Ice Americano'];
for (let day=1; day<=30; day++) {
  const date = `2026-07-${String(day).padStart(2,'0')}`;
  const numTxns = dailySales[day-1] || 3;
  for (let t=0; t<numTxns; t++) {
    const prod = sellProducts[Math.floor(Math.random()*sellProducts.length)];
    const pid = prodMap[prod];
    const qty = Math.floor(Math.random()*3)+1;
    const price = db.prepare('SELECT price FROM product_prices WHERE product_id=? AND effective_to IS NULL ORDER BY id DESC LIMIT 1').get(pid).price;
    const line = qty * price;
    totalRevenue += line;
    
    const txn = db.prepare("INSERT INTO transactions (transacted_at,payment_method,reference) VALUES (?,?,'')").run(date, ['cash','qris','transfer'][Math.floor(Math.random()*3)]);
    db.prepare("INSERT INTO transaction_items (transaction_id,product_id,quantity,unit_price,line_total,hpp_at_sale) VALUES (?,?,?,?,?,0)").run(txn.lastInsertRowid, pid, qty, price, line);
  }
}
console.log(`✅ 30 days of sales (~${dailySales.reduce((a,b)=>a+b,0)} transactions, Rp ${(totalRevenue/1e6).toFixed(2)}M revenue)`);

// ═══ 8. EXPENSES ═══
const expenses = [
  ['2026-07-01','Utilities','Monthly electricity',450000],
  ['2026-07-02','Rent','Monthly rent',3000000],
  ['2026-07-05','Supplies','Cleaning supplies',85000],
  ['2026-07-10','Marketing','Instagram ads',250000],
  ['2026-07-15','Maintenance','AC service',350000],
  ['2026-07-20','Supplies','Paper bags + tissue',120000],
  ['2026-07-25','Utilities','Internet',350000],
];
expenses.forEach(([date,cat,desc,amt]) => {
  db.prepare("INSERT INTO expenses (date,category,description,amount) VALUES (?,?,?,?)").run(date,cat,desc,amt);
});
console.log('✅ 7 expenses recorded');

// ═══ 9. ATTENDANCE ═══
const users = db.prepare('SELECT id,name FROM users WHERE active=1').all();
for (let day=1; day<=30; day++) {
  const date = `2026-07-${String(day).padStart(2,'0')}`;
  // Skip Sundays (day 7,14,21,28)
  if ([7,14,21,28].includes(day)) continue;
  const isWeekday = ![6,13,20,27].includes(day); // Saturday = half day
  
  users.forEach(u => {
    const inTime = `${date}T08:00:00`;
    const outTime = isWeekday ? `${date}T16:00:00` : `${date}T14:00:00`;
    db.prepare("INSERT INTO attendances (employee_name,clock_in,clock_out,user_id) VALUES (?,?,?,?)").run(u.name, inTime, outTime, u.id);
  });
}
console.log('✅ 26 days × 4 users = 104 attendance records');

// ═══ 10. PAYROLL ═══
users.forEach(u => {
  db.prepare("INSERT OR REPLACE INTO payroll (user_id,month,overtime,bonus,deduction) VALUES (?,?,?,?,?)").run(u.id, '2026-07', u.id===2?60000:50000, 30000, 0);
});
console.log('✅ Payroll data for all users');

}); // end transaction

try { tx(); console.log('\n🎉 ALL DONE — Demo data seeded successfully!'); }
catch(e) { console.error('ERROR:', e.message); }
