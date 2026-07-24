const express = require('express');
const db = require('../db');
const router = express.Router();

// POS shift/session tracking: one open session at a time, matching a single
// physical register/drawer. Cash sales/payments "in this session" are
// computed from a time window (transacted_at >= opened_at, and <= closed_at
// once closed) rather than a session_id on every sale — consistent with how
// the rest of the app scopes "today's shift" by date/time instead of a link
// column (see /api/sales's GET, /api/pos-transactions).

function currentOpenSession() {
  return db.prepare("SELECT * FROM pos_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
}

// card payments are stored as payment_method='transfer' (see sales.js's
// paymentMap: card -> transfer) — there's no separate 'card' value in the DB.
function computeExpected(session) {
  const upperBound = session.status === 'closed' && session.closed_at;
  const params = upperBound ? [session.opened_at, session.closed_at] : [session.opened_at];
  const paymentRows = db.prepare(`
    SELECT t.payment_method AS method, COALESCE(SUM(ti.line_total), 0) AS total,
           COUNT(DISTINCT t.id) AS tx_count
    FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE t.transacted_at >= ? ${upperBound ? 'AND t.transacted_at <= ?' : ''}
    GROUP BY t.payment_method
  `).all(...params);

  const payments = { cash: 0, card: 0, qris: 0 };
  const paymentCounts = { cash: 0, card: 0, qris: 0 };
  paymentRows.forEach((r) => {
    if (r.method === 'cash') { payments.cash += r.total; paymentCounts.cash += r.tx_count; }
    else if (r.method === 'qris') { payments.qris += r.total; paymentCounts.qris += r.tx_count; }
    else if (r.method === 'transfer') { payments.card += r.total; paymentCounts.card += r.tx_count; }
  });

  const moveRows = db.prepare(
    `SELECT type, COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE session_id = ? GROUP BY type`
  ).all(session.id);
  let cashIn = 0, cashOut = 0;
  moveRows.forEach((r) => { if (r.type === 'in') cashIn = r.total; else if (r.type === 'out') cashOut = r.total; });

  const expectedCash = Number(session.opening_cash || 0) + payments.cash + cashIn - cashOut;
  return { payments, payment_counts: paymentCounts, cash_in: cashIn, cash_out: cashOut, expected: { cash: expectedCash, card: payments.card, qris: payments.qris } };
}

// GET /api/sessions — shift history. Admin/manager see every shift; staff
// see only shifts THEY opened or closed (matched on their session name,
// same field the open/close flows record) — so a cashier can review their
// own drawer history without exposing every colleague's counted cash and
// variance. Newest first, optional ?month=YYYY-MM filter.
router.get('/', (req, res) => {
  const month = req.query.month;
  const clauses = [];
  const params = [];
  if (month) { clauses.push("strftime('%Y-%m', opened_at) = ?"); params.push(month); }
  if (req.user?.role === 'staff') {
    clauses.push('(opened_by = ? OR closed_by = ?)');
    params.push(req.user.name, req.user.name);
  }
  const rows = db.prepare(`
    SELECT id, opened_at, opened_by, opening_cash, status,
           closed_at, closed_by, counted_cash, counted_card, counted_qris,
           expected_cash, expected_card, expected_qris,
           variance_cash, variance_card, variance_qris, notes
    FROM pos_sessions
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY opened_at DESC, id DESC
    LIMIT 200
  `).all(...params);
  res.json(rows);
});

// GET /api/sessions/open — is there an open session right now?
router.get('/open', (req, res) => {
  const session = currentOpenSession();
  res.json({ opening_required: !session, session: session || null });
});

// POST /api/sessions/open — start a new shift with an opening cash count.
// Idempotent: if one's already open, just returns it rather than erroring
// (a stray double-click/reload shouldn't be able to open two at once).
router.post('/open', (req, res) => {
  const existing = currentOpenSession();
  if (existing) return res.json({ session: existing });
  const openingCash = Math.max(0, Math.round(Number(req.body?.opening_cash || 0)));
  const openedBy = String(req.body?.opened_by || '').trim() || null;
  const info = db.prepare(
    `INSERT INTO pos_sessions (opened_at, opened_by, opening_cash, status)
     VALUES (datetime('now', '+7 hours'), ?, ?, 'open')`
  ).run(openedBy, openingCash);
  const session = db.prepare('SELECT * FROM pos_sessions WHERE id = ?').get(info.lastInsertRowid);
  res.json({ session });
});

// POST /api/sessions/:id/cash-move — record a Cash In/Out.
router.post('/:id/cash-move', (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM pos_sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json({ message: 'Session not found' });
  if (session.status !== 'open') return res.status(400).json({ message: 'This shift is already closed' });
  const type = req.body?.type === 'out' ? 'out' : 'in';
  const amount = Math.round(Number(req.body?.amount || 0));
  if (!(amount > 0)) return res.status(400).json({ message: 'Amount must be positive' });
  const reason = String(req.body?.reason || '').trim() || null;
  const createdBy = String(req.body?.created_by || '').trim() || null;
  db.prepare(
    `INSERT INTO cash_movements (session_id, type, amount, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, datetime('now', '+7 hours'), ?)`
  ).run(id, type, amount, reason, createdBy);
  res.json({ success: true });
});

// GET /api/sessions/:id/cash-moves — this shift's cash in/out history, for
// the Cash In/Out modal's list (it used to be write-only).
router.get('/:id/cash-moves', (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare(
    `SELECT id, type, amount, reason, created_at, created_by FROM cash_movements
     WHERE session_id = ? ORDER BY id DESC`
  ).all(id);
  res.json({ moves: rows });
});

// GET /api/sessions/:id/summary — expected cash/card/qris for Close Shift,
// plus everything the Shift Report needs: who was clocked in during the
// session window, per-payment-type transaction counts, and (once closed) the
// stored counted/variance figures — so this one endpoint powers the
// after-close report AND Shift History's View Report.
router.get('/:id/summary', (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM pos_sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json({ message: 'Session not found' });
  // Staff may always read the OPEN session (the live shift — Close Shift
  // needs it no matter who opened the drawer that morning), but a CLOSED
  // one only if they opened or closed it themselves — mirrors the GET /
  // history filter, so "only their shift history" holds at the API level
  // too, not just in the list the page happens to show.
  if (req.user?.role === 'staff' && session.status === 'closed'
      && session.opened_by !== req.user.name && session.closed_by !== req.user.name) {
    return res.status(403).json({ message: 'You can only view shifts you opened or closed' });
  }
  const calc = computeExpected(session);

  // Attendance rows overlapping the session window. Both tables store WIB
  // wall-clock 'YYYY-MM-DD HH:MM:SS' strings (see header comment), so plain
  // string comparison is the established convention. A row still clocked in
  // (clock_out NULL) counts as overlapping.
  const attendance = db.prepare(`
    SELECT employee_name, clock_in, clock_out FROM attendances
    WHERE clock_in <= COALESCE(?, datetime('now', '+7 hours'))
      AND (clock_out IS NULL OR clock_out >= ?)
    ORDER BY clock_in
  `).all(session.status === 'closed' ? session.closed_at : null, session.opened_at);

  const body = {
    session: {
      id: session.id, name: `#${session.id}`, status: session.status,
      opened_at: session.opened_at, opened_by: session.opened_by
    },
    opening_cash: session.opening_cash,
    payments: calc.payments,
    payment_counts: calc.payment_counts,
    cash_in: calc.cash_in,
    cash_out: calc.cash_out,
    expected: calc.expected,
    attendance
  };
  if (session.status === 'closed') {
    body.closed_at = session.closed_at;
    body.closed_by = session.closed_by;
    body.notes = session.notes;
    body.counted = { cash: session.counted_cash, card: session.counted_card, qris: session.counted_qris };
    body.variance = { cash: session.variance_cash, card: session.variance_card, qris: session.variance_qris };
  }
  res.json(body);
});

// POST /api/sessions/:id/close — record the counted amounts, compute
// variance against expected, and close the shift.
router.post('/:id/close', (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM pos_sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json({ message: 'Session not found' });
  if (session.status !== 'open') return res.status(400).json({ message: 'This shift is already closed' });

  const calc = computeExpected(session);
  const countedCash = Math.round(Number(req.body?.counted_cash || 0));
  const countedCard = Math.round(Number(req.body?.counted_card || 0));
  const countedQris = Math.round(Number(req.body?.counted_qris || 0));
  const notes = String(req.body?.notes || '').trim() || null;
  const closedBy = String(req.body?.closed_by || '').trim() || null;

  db.prepare(`
    UPDATE pos_sessions SET
      status = 'closed',
      closed_at = datetime('now', '+7 hours'),
      closed_by = ?,
      counted_cash = ?, counted_card = ?, counted_qris = ?,
      expected_cash = ?, expected_card = ?, expected_qris = ?,
      variance_cash = ?, variance_card = ?, variance_qris = ?,
      notes = ?
    WHERE id = ?
  `).run(
    closedBy, countedCash, countedCard, countedQris,
    calc.expected.cash, calc.expected.card, calc.expected.qris,
    countedCash - calc.expected.cash, countedCard - calc.expected.card, countedQris - calc.expected.qris,
    notes, id
  );

  res.json({ success: true });
});

module.exports = router;
