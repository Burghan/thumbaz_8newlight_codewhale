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
    SELECT t.payment_method AS method, COALESCE(SUM(ti.line_total), 0) AS total
    FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE t.transacted_at >= ? ${upperBound ? 'AND t.transacted_at <= ?' : ''}
    GROUP BY t.payment_method
  `).all(...params);

  const payments = { cash: 0, card: 0, qris: 0 };
  paymentRows.forEach((r) => {
    if (r.method === 'cash') payments.cash += r.total;
    else if (r.method === 'qris') payments.qris += r.total;
    else if (r.method === 'transfer') payments.card += r.total;
  });

  const moveRows = db.prepare(
    `SELECT type, COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE session_id = ? GROUP BY type`
  ).all(session.id);
  let cashIn = 0, cashOut = 0;
  moveRows.forEach((r) => { if (r.type === 'in') cashIn = r.total; else if (r.type === 'out') cashOut = r.total; });

  const expectedCash = Number(session.opening_cash || 0) + payments.cash + cashIn - cashOut;
  return { payments, cash_in: cashIn, cash_out: cashOut, expected: { cash: expectedCash, card: payments.card, qris: payments.qris } };
}

// GET /api/sessions — shift history (admin/manager only; exposes every
// cashier's counted cash and variance, not staff-safe like the rest of this
// router). Newest first, optional ?month=YYYY-MM filter.
router.get('/', (req, res) => {
  if (req.user?.role === 'staff') return res.status(403).json({ message: 'Manager access required' });
  const month = req.query.month;
  const rows = db.prepare(`
    SELECT id, opened_at, opened_by, opening_cash, status,
           closed_at, closed_by, counted_cash, counted_card, counted_qris,
           expected_cash, expected_card, expected_qris,
           variance_cash, variance_card, variance_qris, notes
    FROM pos_sessions
    ${month ? "WHERE strftime('%Y-%m', opened_at) = ?" : ''}
    ORDER BY opened_at DESC, id DESC
    LIMIT 200
  `).all(...(month ? [month] : []));
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

// GET /api/sessions/:id/summary — expected cash/card/qris for Close Shift.
router.get('/:id/summary', (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM pos_sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json({ message: 'Session not found' });
  const calc = computeExpected(session);
  res.json({
    session: { id: session.id, name: `#${session.id}`, opened_at: session.opened_at, opened_by: session.opened_by },
    opening_cash: session.opening_cash,
    payments: calc.payments,
    cash_in: calc.cash_in,
    cash_out: calc.cash_out,
    expected: calc.expected
  });
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
