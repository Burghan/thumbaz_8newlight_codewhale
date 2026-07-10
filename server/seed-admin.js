// Create/reset an admin user. Usage: node server/seed-admin.js [name] [pin]
const db = require('./db');
const runMigrations = require('./migrate');
const { hashPin } = require('./lib/auth');

runMigrations();

const name = process.argv[2] || 'Owner';
const pin = process.argv[3] || '1234';
const existing = db.prepare('SELECT id FROM users WHERE LOWER(name) = ?').get(name.toLowerCase());

if (existing) {
  db.prepare("UPDATE users SET pin_hash = ?, role = 'admin', active = 1 WHERE id = ?").run(hashPin(pin), existing.id);
} else {
  db.prepare("INSERT INTO users (name, role, pin_hash, active) VALUES (?, 'admin', ?, 1)").run(name, hashPin(pin));
}
console.log(`✅ admin '${name}' ready (PIN ${pin.length} digits) — change it in the app.`);
db.close();
