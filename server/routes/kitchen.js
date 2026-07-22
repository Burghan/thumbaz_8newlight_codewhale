const express = require('express');
const db = require('../db');

const router = express.Router();

const getTicket = db.prepare('SELECT * FROM kitchen_tickets WHERE id = ?');
const getItemsForTickets = (ids) => {
  if (!ids.length) return [];
  return db.prepare(
    `SELECT * FROM kitchen_items WHERE ticket_id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
};

function serializeTickets(tickets) {
  const items = getItemsForTickets(tickets.map((t) => t.id));
  const byTicket = new Map();
  tickets.forEach((t) => byTicket.set(t.id, { ...t, items: [] }));
  items.forEach((item) => {
    const t = byTicket.get(item.ticket_id);
    if (t) t.items.push(item);
  });
  return Array.from(byTicket.values());
}

// GET /api/kitchen — the barista screen's ticket feed. ?status= filters
// (e.g. hide 'served'/'cancelled' on the live board).
router.get('/', (req, res) => {
  const status = String(req.query.status || '').trim();
  const tickets = status
    ? db.prepare('SELECT * FROM kitchen_tickets WHERE status = ? ORDER BY id DESC').all(status)
    : db.prepare('SELECT * FROM kitchen_tickets ORDER BY id DESC').all();
  res.json({ tickets: serializeTickets(tickets) });
});

// created_at/updated_at set explicitly (WIB) — the columns' own DEFAULT is
// bare datetime('now'), i.e. UTC (same class of bug as stock_movements had).
const insertTicket = db.prepare(
  `INSERT INTO kitchen_tickets (order_ref, table_label, order_type, status, created_at, updated_at)
   VALUES (?, ?, ?, 'new', datetime('now', '+7 hours'), datetime('now', '+7 hours'))`
);
const insertItem = db.prepare(
  `INSERT INTO kitchen_items (ticket_id, product_id, name, qty, note) VALUES (?, ?, ?, ?, ?)`
);
const deleteItemsForTicket = db.prepare('DELETE FROM kitchen_items WHERE ticket_id = ?');
const touchTicket = db.prepare(
  `UPDATE kitchen_tickets SET status = 'new', table_label = ?, order_type = ?, updated_at = datetime('now', '+7 hours') WHERE id = ?`
);
const findOpenTicketByRef = db.prepare(
  `SELECT * FROM kitchen_tickets WHERE order_ref = ? AND status NOT IN ('served', 'cancelled') ORDER BY id DESC LIMIT 1`
);

function writeItems(ticketId, items) {
  items.forEach((item) => {
    insertItem.run(
      ticketId,
      Number(item.productId || item.product_id || 0) || null,
      String(item.name || item.product_name || 'Item'),
      Number(item.qty || 1) || 1,
      String(item.note || '').trim() || null
    );
  });
}

// POST /api/kitchen — send (or update/cancel) a ticket. type: 'new' always
// creates a fresh ticket; 'update' replaces items on the existing open
// ticket for this order_ref (falls back to creating one); 'cancel' marks
// the existing ticket cancelled so it drops off the live board.
router.post('/', (req, res) => {
  const orderRef = String(req.body?.order_id || '').trim() || null;
  const tableLabel = String(req.body?.table || '').trim() || null;
  const orderType = String(req.body?.order_type || 'dine_in').trim();
  const type = String(req.body?.type || 'new').trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (type === 'cancel') {
    const existing = orderRef ? findOpenTicketByRef.get(orderRef) : null;
    if (existing) {
      db.prepare(`UPDATE kitchen_tickets SET status = 'cancelled', updated_at = datetime('now', '+7 hours') WHERE id = ?`).run(existing.id);
    }
    return res.json({ success: true, cancelled: Boolean(existing) });
  }

  if (!items.length) return res.status(400).json({ error: 'No items' });

  const tx = db.transaction(() => {
    const existing = type === 'update' && orderRef ? findOpenTicketByRef.get(orderRef) : null;
    let ticketId;
    if (existing) {
      ticketId = existing.id;
      deleteItemsForTicket.run(ticketId);
      touchTicket.run(tableLabel, orderType, ticketId);
    } else {
      ticketId = insertTicket.run(orderRef, tableLabel, orderType).lastInsertRowid;
    }
    writeItems(ticketId, items);
    return ticketId;
  });

  const ticketId = tx();
  res.json({ success: true, ticket: serializeTickets([getTicket.get(ticketId)])[0] });
});

// PATCH /api/kitchen/:id — advance/change a ticket's status (New → Preparing
// → Ready → Served, or Cancelled), driven by the barista screen.
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  const allowed = ['new', 'preparing', 'ready', 'served', 'cancelled'];
  if (!id || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Missing ticket id or invalid status' });
  }
  const existing = getTicket.get(id);
  if (!existing) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare(`UPDATE kitchen_tickets SET status = ?, updated_at = datetime('now', '+7 hours') WHERE id = ?`).run(status, id);
  res.json({ success: true });
});

// DELETE /api/kitchen/:id — remove a ticket entirely (e.g. created by mistake).
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Missing ticket id' });
  deleteItemsForTicket.run(id);
  db.prepare('DELETE FROM kitchen_tickets WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
