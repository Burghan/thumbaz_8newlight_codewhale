// Simple, ordered SQL migration runner.
// Applies server/migrations/NNN_*.sql files in filename order, once each,
// tracking applied files in the schema_migrations table. Safe to re-run.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function run() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name)
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    });
    tx();
    console.log(`✅ applied ${file}`);
    count++;
  }

  if (count === 0) console.log('✔ migrations up to date');
  else console.log(`✔ applied ${count} migration(s)`);
}

if (require.main === module) {
  run();
  db.close();
}

module.exports = run;
