const express = require('express');
const db = require('../db');

const router = express.Router();

function rowToOrder(row) {
  if (!row) return null;
  let items = [];
  try { items = JSON.parse(row.items_json || '[]'); } catch (e) { items = []; }
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    orderType: row.order_type,
    customerName: row.customer_name,
    cashierName: row.cashier_name,
    receiptNumber: row.receipt_number,
    isInvoice: !!row.is_invoice,
    sentToKitchen: !!row.sent_to_kitchen,
    total: row.total,
    items,
    saleId: row.sale_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at
  };
}

// GET /api/held-orders?status=&order_type=&q= — the Orders tab's list.
// Shared across every device/browser (this used to be per-browser
// localStorage), so any staff member sees the same orders as everyone else.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { status, order_type, q } = req.query;
  const clauses = [];
  const params = [];
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (order_type) { clauses.push('order_type = ?'); params.push(order_type); }
  if (q) {
    clauses.push('(label LIKE ? OR customer_name LIKE ? OR receipt_number LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM held_orders ${where} ORDER BY updated_at DESC`).all(...params);
  res.json({ orders: rows.map(rowToOrder) });
});

// PUT /api/held-orders/:id — upsert. Body mirrors what pos-new.js's old
// client-side upsertHeldOrder() destructured: label, sentToKitchen, status,
// receiptNumber, isInvoice, customerName, orderType, total, items, saleId.
// The merge-with-existing logic that function used to do client-side (racy
// once two devices share one till) now happens here, atomically, so it's
// safe under concurrent staff.
router.put('/:id', (req, res) => {
  const id = String(req.params.id);
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM held_orders WHERE id = ?').get(id);

  const items = Array.isArray(b.items) ? b.items : (existing ? JSON.parse(existing.items_json || '[]') : []);
  const total = typeof b.total === 'number' ? b.total : (existing ? existing.total : 0);
  const resolvedCustomerName = b.customerName !== undefined ? b.customerName : (existing ? existing.customer_name : null);
  // A customer name is more useful in the Orders list than a generic label
  // — only fall back when no name was actually entered. The shop doesn't run
  // a per-table/tab system (no dine-in kitchen workflow active yet — see
  // [[project-orders-server-side-2026-07-24]]), so every order defaults to
  // the same "Direct Sale" label sendOrderToKitchen already uses for a
  // no-table ticket, not an auto-numbered "Tab N".
  const resolvedLabel = b.label || resolvedCustomerName || (existing ? existing.label : null) || 'Direct Sale';
  const status = b.status || (existing ? existing.status : null) || (b.sentToKitchen ? 'ongoing' : 'draft');
  const orderType = b.orderType || (existing ? existing.order_type : null);
  const receiptNumber = b.receiptNumber !== undefined ? b.receiptNumber : (existing ? existing.receipt_number : null);
  const isInvoice = b.isInvoice !== undefined ? (b.isInvoice ? 1 : 0) : (existing ? existing.is_invoice : 0);
  const sentToKitchen = b.sentToKitchen !== undefined ? (b.sentToKitchen ? 1 : 0) : (existing ? existing.sent_to_kitchen : 0);
  const saleId = b.saleId !== undefined ? b.saleId : (existing ? existing.sale_id : null);
  const paidAt = (status === 'paid' || status === 'invoice')
    ? (existing && existing.paid_at ? existing.paid_at : new Date().toISOString())
    : (existing ? existing.paid_at : null);
  // Set once, kept on every later update — a shared till may have a
  // different staff member logged in by the time the same order is Saved
  // again or paid. Server-trusted (req.user), never taken from the client.
  const cashierName = existing ? existing.cashier_name : (req.user?.name || null);

  db.prepare(`
    INSERT INTO held_orders
      (id, label, status, order_type, customer_name, cashier_name, receipt_number,
       is_invoice, sent_to_kitchen, total, items_json, sale_id, updated_at, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'), ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      status = excluded.status,
      order_type = excluded.order_type,
      customer_name = excluded.customer_name,
      receipt_number = excluded.receipt_number,
      is_invoice = excluded.is_invoice,
      sent_to_kitchen = excluded.sent_to_kitchen,
      total = excluded.total,
      items_json = excluded.items_json,
      sale_id = excluded.sale_id,
      updated_at = excluded.updated_at,
      paid_at = excluded.paid_at
  `).run(
    id, resolvedLabel, status, orderType, resolvedCustomerName, cashierName, receiptNumber,
    isInvoice, sentToKitchen, total, JSON.stringify(items), saleId, paidAt
  );

  const row = db.prepare('SELECT * FROM held_orders WHERE id = ?').get(id);
  res.json({ order: rowToOrder(row) });
});

// DELETE /api/held-orders/:id — Cancel Order (draft) or dropping the Orders
// row once its sale is voided (it no longer points at a reprintable sale).
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM held_orders WHERE id = ?').run(String(req.params.id));
  res.json({ message: 'Removed' });
});

module.exports = router;
