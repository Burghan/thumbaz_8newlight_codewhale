// Read-only diagnostic: finds attendance rows that look like leftover
// seed/test data rather than real clock-ins — same employee + same
// calendar date appearing more than once, and/or a suspiciously round
// 08:00:00 -> 16:00:00 clock-in/out with no photo attached (a real clock-in
// always has photo_in from the camera capture in clock.html).
//
// Does NOT delete or modify anything. Run this first, review the output,
// and only write a cleanup script once we've confirmed together which rows
// (if any) are safe to remove — this data feeds Payroll, so a wrong delete
// could shortchange someone's real hours.
//
//   node server/inspect-attendance-duplicates.js
//   DB_PATH=/path/backoffice.db node server/inspect-attendance-duplicates.js

const path = require('path');
const db = require('./db');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../data/backoffice.db');
console.log('Database file:', dbPath);
console.log('');

const rows = db.prepare(`
  SELECT id, user_id, employee_name, clock_in, clock_out, photo_in, photo_out, notes, created_at
  FROM attendances
  ORDER BY user_id, date(clock_in), id
`).all();

console.log(`Total attendance rows: ${rows.length}`);
console.log('');

// Group by employee + calendar date of clock_in.
const groups = new Map();
for (const r of rows) {
  const day = String(r.clock_in || '').slice(0, 10);
  const key = `${r.user_id}|${day}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const dupGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
console.log(`Employee+date combos with MORE THAN ONE row: ${dupGroups.length}`);
for (const [key, list] of dupGroups) {
  const [userId, day] = key.split('|');
  console.log(`\n  user_id=${userId} (${list[0].employee_name}) on ${day} — ${list.length} rows:`);
  for (const r of list) {
    const hasPhoto = r.photo_in || r.photo_out ? 'photo' : 'NO PHOTO';
    console.log(`    id=${r.id}  in=${r.clock_in}  out=${r.clock_out || '—'}  ${hasPhoto}  created_at=${r.created_at}`);
  }
}

console.log('\n---');

// Round-number 08:00:00/16:00:00 with no photo — the specific pattern from
// the reported screenshot.
const roundNoPhoto = rows.filter((r) => {
  const inTime = String(r.clock_in || '').slice(11, 19);
  const outTime = String(r.clock_out || '').slice(11, 19);
  return inTime === '08:00:00' && outTime === '16:00:00' && !r.photo_in && !r.photo_out;
});
console.log(`Rows matching "08:00:00 -> 16:00:00, no photo": ${roundNoPhoto.length}`);
for (const r of roundNoPhoto) {
  console.log(`  id=${r.id}  user_id=${r.user_id} (${r.employee_name})  in=${r.clock_in}  out=${r.clock_out}  created_at=${r.created_at}`);
}

console.log('\nNothing was changed — this is a report only.');
