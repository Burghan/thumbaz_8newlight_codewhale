// Maintenance tool: deletes clock-in/out photos older than N days (default
// 7) and nulls out the matching attendances.photo_in/photo_out column so the
// UI doesn't show a broken image icon for a photo that's been recycled.
//
// Photos are named clockin_<epoch-ms>.jpg / clockout_<epoch-ms>.jpg (see
// server/routes/attendance.js) — the age is parsed directly from the
// filename itself, so this works even for a row that's no longer in the DB
// (e.g. after a data reset) and doesn't need to touch the database at all
// to know what's stale.
//
// Meant to run on a schedule (e.g. a weekly cron every Sunday) — see the
// crontab line in the comment at the bottom. Safe to run by hand too.
//
// SAFE BY DEFAULT: with no flag it only reports what it WOULD delete (dry
// run). Pass --yes to actually delete the files + clear the DB references.
//
//   node server/clean-old-attendance-photos.js                 # dry run, 7 days
//   node server/clean-old-attendance-photos.js --yes            # delete, 7 days
//   node server/clean-old-attendance-photos.js --days=14 --yes  # custom age
//   DB_PATH=/path/backoffice.db node server/clean-old-attendance-photos.js --yes

const fs = require('fs');
const path = require('path');
const db = require('./db');

const CONFIRM = process.argv.includes('--yes');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? Number(daysArg.split('=')[1]) : 7;

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../data/backoffice.db');
const PHOTO_DIR = path.join(__dirname, '..', 'data', 'photos');

console.log('Database file:', dbPath);
console.log('Photo directory:', PHOTO_DIR);
console.log(`Recycling photos older than ${DAYS} day(s)`);
console.log('');

if (!fs.existsSync(PHOTO_DIR)) {
  console.log('No photo directory found — nothing to clean up.');
  process.exit(0);
}

const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
const NAME_RE = /^(clockin|clockout)_(\d+)\.(jpg|jpeg|png)$/i;

const files = fs.readdirSync(PHOTO_DIR);
const stale = [];
for (const name of files) {
  const m = name.match(NAME_RE);
  if (!m) continue; // not one of ours — leave it alone
  const epochMs = Number(m[2]);
  if (!Number.isFinite(epochMs) || epochMs >= cutoff) continue;
  stale.push({ name, kind: m[1], epochMs, path: path.join(PHOTO_DIR, name) });
}

if (!stale.length) {
  console.log('Nothing older than the cutoff — nothing to clean up.');
  process.exit(0);
}

const totalBytes = stale.reduce((sum, f) => sum + (fs.statSync(f.path).size || 0), 0);
console.log(`Found ${stale.length} stale photo(s), ${(totalBytes / 1024).toFixed(0)} KB total`);
console.log(`Oldest: ${new Date(Math.min(...stale.map((f) => f.epochMs))).toLocaleString('id-ID')}`);
console.log(`Newest (of the stale ones): ${new Date(Math.max(...stale.map((f) => f.epochMs))).toLocaleString('id-ID')}`);
console.log('');

if (!CONFIRM) {
  console.log('DRY RUN — nothing changed. Re-run with  --yes  to actually delete these.');
  process.exit(0);
}

let deleted = 0, cleared = 0;
const clearIn = db.prepare("UPDATE attendances SET photo_in = NULL WHERE photo_in = ?");
const clearOut = db.prepare("UPDATE attendances SET photo_out = NULL WHERE photo_out = ?");

for (const f of stale) {
  try {
    fs.unlinkSync(f.path);
    deleted++;
    const dbPathValue = `/data/photos/${f.name}`;
    const info = f.kind === 'clockin' ? clearIn.run(dbPathValue) : clearOut.run(dbPathValue);
    cleared += info.changes;
  } catch (e) {
    console.log(`  Failed to remove ${f.name}: ${e.message}`);
  }
}

console.log(`Deleted ${deleted} file(s); cleared ${cleared} database reference(s).`);

// --- Weekly schedule (set up once on the droplet, e.g. via `crontab -e`) ---
// Runs every Sunday at 03:00 server time, deletes anything over 7 days old,
// logs to a file so you can check it ran:
//
//   0 3 * * 0 cd /var/www/thumbaz-8newlight && node server/clean-old-attendance-photos.js --yes >> data/photo-cleanup.log 2>&1
//
// `0` for day-of-week = Sunday. Adjust the hour (`3`) if you'd rather it run
// at a different time — early morning avoids colliding with real clock-ins.
