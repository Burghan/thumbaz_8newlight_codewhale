const express = require('express');
const db = require('../db');
const fs = require('fs');
const path = require('path');
const { wibNowIso, wibToday, wibMonth } = require('../lib/time');
const router = express.Router();

const PHOTO_DIR = path.join(__dirname, '..', '..', 'data', 'photos');
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

// The mount (/api/attendance) is open to staff so they can clock in/out; these
// sub-routes carry payroll figures or every employee's history, so they stay
// admin/manager only even though the router itself is staff-reachable.
function managerOnly(req, res, next) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Manager or admin only' });
  next();
}

// Today's attendance
router.get('/today', (req, res) => {
  const today = wibToday();
  const rows = db.prepare(`SELECT * FROM attendances WHERE date(clock_in) = ? OR date(clock_out) = ? ORDER BY id DESC`).all(today, today);
  res.json(rows);
});
// Saved payroll bonus per user for a month — independent of attendance rows,
// so admin/manager (who may have no clock-in records at all) still see a
// bonus that was saved for them. Overtime/deduction are no longer read from
// here; Payroll now derives both from attendance + rate on every load.
router.get('/payroll', managerOnly, (req, res) => {
  const month = req.query.month || wibMonth();
  const rows = db.prepare('SELECT user_id, bonus FROM payroll WHERE month = ?').all(month);
  res.json(rows);
});

// Save payroll data (bonus; overtime/deduction kept 0 — computed, not stored)
router.post('/payroll', managerOnly, (req, res) => {
  const { user_id, month, overtime, bonus, deduction } = req.body || {};
  if (!user_id || !month) return res.status(400).json({ error: 'user_id and month required' });
  db.prepare(`INSERT OR REPLACE INTO payroll (user_id, month, overtime, bonus, deduction)
    VALUES (?,?,?,?,?)`).run(user_id, month, Number(overtime||0), Number(bonus||0), Number(deduction||0));
  res.json({ message: 'Payroll saved' });
});

// Get attendance history for a given month
router.get('/history', managerOnly, (req, res) => {
  const month = req.query.month || wibMonth();
  const rows = db.prepare(`
    SELECT a.*, p.overtime, p.bonus, p.deduction
    FROM attendances a
    LEFT JOIN payroll p ON p.user_id = a.user_id AND p.month = ?
    WHERE strftime('%Y-%m', a.clock_in) = ? OR strftime('%Y-%m', a.clock_out) = ?
    ORDER BY a.id DESC LIMIT 200
  `).all(month, month, month);
  res.json(rows);
});

// Get a specific attendance record
router.get('/:id', managerOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM attendances WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Clock-in with photo
router.post('/clock-in', (req, res) => {
  const { user_id, photo } = req.body || {};
  const user = user_id ? db.prepare('SELECT name FROM users WHERE id=? AND active=1').get(user_id) : null;
  if (!user) return res.status(400).json({ error: 'Valid employee required' });

  const now = wibNowIso();
  let photoPath = null;

  if (photo) {
    const filename = `clockin_${Date.now()}.jpg`;
    const filepath = path.join(PHOTO_DIR, filename);
    const base64Data = photo.replace(/^data:image\/jpeg;base64,/, '').replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
    photoPath = `/data/photos/${filename}`;
  }

  const info = db.prepare(`INSERT INTO attendances (employee_name, clock_in, photo_in, user_id) VALUES (?, ?, ?, ?)`)
    .run(user.name, now, photoPath, user_id);

  res.json({ message: 'Clocked in', id: info.lastInsertRowid, time: now, photo: photoPath });
});

// Clock-out with photo
router.post('/clock-out', (req, res) => {
  const { user_id, photo } = req.body || {};
  const user = user_id ? db.prepare('SELECT name FROM users WHERE id=? AND active=1').get(user_id) : null;
  if (!user) return res.status(400).json({ error: 'Valid employee required' });

  const now = wibNowIso();
  let photoPath = null;

  if (photo) {
    const filename = `clockout_${Date.now()}.jpg`;
    const filepath = path.join(PHOTO_DIR, filename);
    const base64Data = photo.replace(/^data:image\/jpeg;base64,/, '').replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
    photoPath = `/data/photos/${filename}`;
  }

  // Find the last clock-in without a clock-out for this employee today
  const today = wibToday();
  const row = db.prepare(`SELECT id FROM attendances WHERE user_id = ? AND date(clock_in) = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1`)
    .get(user_id, today);

  if (row) {
    db.prepare(`UPDATE attendances SET clock_out = ?, photo_out = ? WHERE id = ?`).run(now, photoPath, row.id);
    res.json({ message: 'Clocked out', id: row.id, time: now, photo: photoPath });
  } else {
    // No open clock-in found — create a new record with just clock-out
    const info = db.prepare(`INSERT INTO attendances (employee_name, clock_out, photo_out, user_id) VALUES (?, ?, ?, ?)`)
      .run(user.name, now, photoPath, user_id);
    res.json({ message: 'Clocked out (no prior clock-in)', id: info.lastInsertRowid, time: now, photo: photoPath });
  }
});

// Get attendance history
router.get('/history/:name', managerOnly, (req, res) => {
  const rows = db.prepare(`SELECT * FROM attendances WHERE employee_name = ? ORDER BY id DESC LIMIT 50`).all(req.params.name);
  res.json(rows);
});

module.exports = router;

