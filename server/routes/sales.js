const express = require('express');
const db = require('../db');
const { deductStockForSale, deductIngredientsForSale } = require('../lib/stock');
const { getLoyaltyConfig } = require('./loyalty-config');
const { voidSale, voidPartialItem } = require('../lib/voidSale');
const { verifyManagerPin } = require('../lib/auth');
const { tokenFor } = require('../lib/receiptToken');
const router = express.Router();

// Loyalty earn/redeem rules now live in the loyalty_config table (managed from
// the POS "Loyalty Setup" screen) instead of hardcoded constants:
//   earn_base / earn_points — earn this many points per this many rupiah spent
//   redeem_rate             — rupiah discount per point redeemed
//   enabled                 — 0 turns earn + redeem off entirely
// Read authoritatively here so the stored award can't drift from what the
// client previewed, or be tampered with client-side.

// Resolve the price_delta (whole rupiah) for one modifier entry attached to a
// cart line. Entries come in two shapes from pos.html:
//   { id, price_delta? }                         → a saved modifier (table lookup)
//   { custom_name, price_delta, ... }            → a one-off custom add-on
// A client-supplied price_delta always wins so overrides/customs are honoured;
// otherwise we trust the modifiers table so a stale/absent client price can't
// under-charge. Unknown ids contribute 0.
function modifierDelta(entry, getModPrice) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.price_delta !== undefined && entry.price_delta !== null && Number.isFinite(Number(entry.price_delta))) {
    return Math.round(Number(entry.price_delta));
  }
  if (entry.id !== undefined && entry.id !== null) {
    const row = getModPrice.get(Number(entry.id));
    return row ? Math.round(Number(row.price_delta) || 0) : 0;
  }
  return 0;
}

// POST /api/sales — adapter for coffee-pos format → our transactions table.
router.post('/', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items' });

  const paymentMap = { cash: 'cash', qris: 'qris', transfer: 'transfer', card: 'transfer' };
  const payment = paymentMap[b.payment_type] || 'cash';

  const getModPrice = db.prepare('SELECT price_delta FROM modifiers WHERE id = ?');
  // A modifier may link to a menu product (Option A); selling the modifier then
  // deducts that product's recipe from inventory.
  const getModProduct = db.prepare('SELECT product_id FROM modifiers WHERE id = ?');

  const customerNote = String(b.note || '').trim() || null;
  const customerId = Number.isInteger(Number(b.customer_id)) && Number(b.customer_id) > 0
    ? Number(b.customer_id) : null;
  const requestedRedeem = Math.max(0, Math.floor(Number(b.redeem_points || 0)));
  // Whole-order discount, entered as a percent at Payment. Clamped 0..100; the
  // rupiah amount is derived server-side from the actual line total.
  const discountPct = Math.max(0, Math.min(100, Math.floor(Number(b.discount_pct || 0))));
  const discountReason = String(b.discount_reason || '').trim() || null;
  // Server-side enforcement — the client checks this PIN first for immediate
  // feedback (POST /api/auth/verify-manager-pin), but that alone couldn't stop
  // someone from calling this endpoint directly with a discount and no PIN.
  if (discountPct > 0 && !verifyManagerPin(db, String(b.manager_pin || '').trim())) {
    return res.status(403).json({ error: 'Valid manager PIN required for a discount.' });
  }

  let pointsEarned = 0;
  let redeemPoints = 0;
  let redeemValue = 0;
  let discountValue = 0;
  let customerRow = null;

  const tx = db.transaction(() => {
    // Verify the customer exists before linking a sale to it — an unknown/
    // stale id (e.g. picked in one tab, deleted in another) just means no
    // loyalty link rather than a broken sale.
    const customer = customerId ? db.prepare('SELECT id, points_balance FROM customers WHERE id = ?').get(customerId) : null;

    const txn = db.prepare(
      // WIB (UTC+7) wall-clock time, matching how Riwayat imports store the
      // source .xls's own local timestamps — see server/lib/time.js.
      // order_type has its own column (previously this INSERT omitted it
      // entirely and instead stuffed the order type — plus a discount_amount
      // that was never even sent by the client — into `notes`, which is
      // meant for an actual customer note and gets shown as one in
      // Transaction History's order drawer). cashier_name was ALSO never
      // written for a live sale (only imported Riwayat rows had it) — taken
      // from the authenticated session, not the client body, since the
      // server already knows who's logged in.
      `INSERT INTO transactions (transacted_at, payment_method, order_type, customer_note, customer_id, cashier_name)
       VALUES (datetime('now', '+7 hours'), ?, ?, ?, ?, ?)`
    ).run(payment, String(b.order_type || 'Dine In').trim(), customerNote, customer ? customer.id : null, req.user?.name || null);

    const txnId = txn.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, line_total, hpp_at_sale)
       VALUES (?,?,?,?,?,0)`
    );

    let saleTotal = 0;
    for (const item of items) {
      const qty = Number(item.quantity || 1);
      const base = Math.round(Number(item.price || 0));
      // Fold each attached modifier's price into the recorded unit price so the
      // stored line_total matches what the customer was actually charged
      // (previously modifiers were shown in the cart but lost at checkout).
      const modSum = (Array.isArray(item.modifiers) ? item.modifiers : [])
        .reduce((sum, m) => sum + modifierDelta(m, getModPrice), 0);
      const effective = base + modSum;
      insItem.run(txnId, item.product_id, qty, effective, qty * effective);
      saleTotal += qty * effective;
    }

    // Apply the whole-order discount to the line total; everything downstream
    // (redemption cap, loyalty earn) works off the discounted bill.
    discountValue = Math.round(saleTotal * discountPct / 100);
    const afterDiscount = Math.max(0, saleTotal - discountValue);
    if (discountPct > 0) {
      db.prepare('UPDATE transactions SET discount_pct = ?, discount_amount = ?, discount_reason = ? WHERE id = ?')
        .run(discountPct, discountValue, discountReason, txnId);
    }

    const loyalty = getLoyaltyConfig();
    if (customer && loyalty.enabled) {
      // Redemption first — clamp to what they actually have and to the
      // discounted total (can't redeem more than the bill). redeem_value is
      // derived here, never trusted from the client.
      if (requestedRedeem > 0 && loyalty.redeem_rate > 0) {
        redeemPoints = Math.min(requestedRedeem, customer.points_balance);
        redeemValue = redeemPoints * loyalty.redeem_rate;
        if (redeemValue > afterDiscount) {
          redeemValue = afterDiscount;
          redeemPoints = Math.ceil(redeemValue / loyalty.redeem_rate);
        }
        if (redeemPoints > 0) {
          db.prepare('UPDATE customers SET points_balance = points_balance - ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(redeemPoints, customer.id);
        }
      }
      // Earn on what was actually paid (net of discount and redemption).
      const netTotal = Math.max(0, afterDiscount - redeemValue);
      pointsEarned = loyalty.earn_base > 0 ? Math.floor(netTotal / loyalty.earn_base) * loyalty.earn_points : 0;
      if (pointsEarned > 0) {
        db.prepare('UPDATE customers SET points_balance = points_balance + ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(pointsEarned, customer.id);
      }
      db.prepare('UPDATE transactions SET points_earned = ?, redeem_points = ?, redeem_value = ? WHERE id = ?')
        .run(pointsEarned, redeemPoints, redeemValue, txnId);
      customerRow = db.prepare('SELECT id, name, member_id, points_balance FROM customers WHERE id = ?').get(customer.id);
    } else if (customer) {
      // Program off: still link the customer to the sale, just no points move.
      customerRow = db.prepare('SELECT id, name, member_id, points_balance FROM customers WHERE id = ?').get(customer.id);
    }
    return txnId;
  });

  const txnId = tx();
  // Deduct stock for recipe ingredients
  deductStockForSale(txnId, items.map(item => ({ product_id: item.product_id, quantity: item.quantity || 1 })));
  // Also deduct the recipe of any product-linked modifier attached to a line
  // (Option A), scaled by that line's quantity. Logged as the same 'usage'
  // movements tagged to this sale, so Void reverses them and COGS counts them.
  const modProductItems = [];
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    for (const m of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
      if (m && m.id !== undefined && m.id !== null) {
        const row = getModProduct.get(Number(m.id));
        if (row && row.product_id) {
          modProductItems.push({ product_id: row.product_id, quantity: qty });
        }
      }
    }
  }
  if (modProductItems.length) deductStockForSale(txnId, modProductItems);
  // Ad-hoc ingredient lines attached to a line (Phase 2): custom-item on-the-fly
  // recipes and quick ingredient add-ons. Scale each by the line's quantity.
  const extraIngredients = [];
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    for (const ing of (Array.isArray(item.extra_ingredients) ? item.extra_ingredients : [])) {
      const ingredientId = Number(ing && ing.ingredient_id);
      const perUnit = Number(ing && ing.qty_base);
      if (Number.isInteger(ingredientId) && perUnit > 0) {
        extraIngredients.push({ ingredient_id: ingredientId, qty_base: perUnit * qty });
      }
    }
  }
  if (extraIngredients.length) deductIngredientsForSale(txnId, extraIngredients);
  // Lookup transaction with items to return in POS format
  const txn = db.prepare('SELECT id, transacted_at, payment_method FROM transactions WHERE id=?').get(txnId);
  const txnItems = db.prepare(`
    SELECT ti.product_id, ti.quantity, ti.unit_price, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transaction_id=?`).all(txnId);

  res.json({
    success: true,
    sale_id: txn.id,
    receipt_token: tokenFor(txn.id),
    message: 'Sale completed',
    sale: {
      id: txn.id,
      created_at: txn.transacted_at,
      payment_type: txn.payment_method,
      items: txnItems.map(i => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, price: i.unit_price, total: i.line_total }))
    },
    points_earned: pointsEarned,
    redeem_points: redeemPoints,
    redeem_value: redeemValue,
    discount_pct: discountPct,
    discount_amount: discountValue,
    customer: customerRow
  });
});

// POST /api/sales/:id/void — reverse a paid sale. Body: { reason, restock }.
//   restock = true  → the item was NOT made (mis-tap / cancel): return the
//                     ingredients to stock and drop their usage movements, as
//                     if the sale never happened.
//   restock = false → the item WAS made (comp / correction): reverse the money
//                     only; the ingredients stay consumed (inventory + usage
//                     movements untouched) so stock and COGS stay truthful.
// Either way the transaction/items stay in place (tagged status='Dibatalkan',
// quantity/line_total zeroed so revenue nets out automatically) rather than
// being deleted — same convention the Riwayat import already uses for a
// cancelled receipt — and the void is recorded in void_log for the shift's
// audit trail.
router.post('/:id/void', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid sale id' });

  // Staff need an actual manager's PIN, verified server-side (the client
  // already checks it too, for immediate feedback — this is the enforcement).
  // A logged-in admin/manager voiding is already the authority, no PIN needed.
  if (req.user?.role === 'staff' && !verifyManagerPin(db, String(req.body?.manager_pin || '').trim())) {
    return res.status(403).json({ error: 'Valid manager PIN required to void.' });
  }

  const restock = req.body?.restock === true || req.body?.restock === 'true' || req.body?.restock === 1;
  const reason = String(req.body?.reason || '').trim();

  const result = voidSale(id, { restock, reason });
  if (!result.ok) return res.status(404).json({ error: result.error });

  res.json({
    success: true,
    message: restock ? 'Sale voided — ingredients returned to stock.' : 'Sale voided — inventory kept as used.'
  });
});

// POST /api/sales/:id/void-item — correct one line item's quantity downward
// (e.g. rung up 2, should've been 1) without voiding the whole order.
// Body: { item_id, new_qty, reason, restock }.
router.post('/:id/void-item', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid sale id' });

  const itemId = Number(req.body?.item_id);
  const newQty = Number(req.body?.new_qty);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'Invalid item_id' });

  if (req.user?.role === 'staff' && !verifyManagerPin(db, String(req.body?.manager_pin || '').trim())) {
    return res.status(403).json({ error: 'Valid manager PIN required to correct a quantity.' });
  }

  const restock = req.body?.restock === true || req.body?.restock === 'true' || req.body?.restock === 1;
  const reason = String(req.body?.reason || '').trim();

  const result = voidPartialItem(id, { itemId, newQty, reason, restock });
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.json({
    success: true,
    message: `Quantity corrected — ${result.removedQty} unit(s) removed (Rp${result.removedTotal.toLocaleString('id-ID')}).`
      + (restock ? ' Ingredients returned to stock.' : ' Inventory kept as used.')
  });
});

// GET /api/sales — today's sales (this shift), for the POS void picker.
// GET /api/sales?scope=all — most recent sales regardless of date, for the
// read-only reprint picker (voiding stays shift-restricted on purpose; reprint
// doesn't change anything, so there's no reason to hide older sales from it).
router.get('/', (req, res) => {
  const scopeToday = req.query.scope !== 'all';
  const rows = db.prepare(`
    SELECT t.id, t.transacted_at, t.payment_method,
           SUM(ti.line_total) AS total,
           GROUP_CONCAT(ti.quantity || '× ' || p.name, ', ') AS items
    FROM transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id
    JOIN products p ON p.id = ti.product_id
    ${scopeToday ? "WHERE date(t.transacted_at) = date('now', '+7 hours')" : ''}
    GROUP BY t.id ORDER BY t.id DESC LIMIT 50
  `).all();
  res.json(rows);
});

// GET /api/sales/:id — full detail for one sale, for reprinting its receipt.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid sale id' });

  const txn = db.prepare(`
    SELECT id, transacted_at, payment_method, reference, customer_name,
           customer_note, cashier_name, order_type, tax, service_fee, customer_id
    FROM transactions WHERE id = ?`).get(id);
  if (!txn) return res.status(404).json({ error: 'Sale not found' });

  const customer = txn.customer_id
    ? db.prepare('SELECT name FROM customers WHERE id = ?').get(txn.customer_id)
    : null;

  // Only still-live lines — a fully voided item (quantity zeroed, tagged
  // Dibatalkan/Batal Sebagian) shouldn't show up on a reprinted receipt or be
  // offered again in the void-by-item picker.
  const items = db.prepare(`
    SELECT ti.id, ti.product_id, ti.quantity, ti.unit_price, ti.line_total, p.name
    FROM transaction_items ti JOIN products p ON p.id = ti.product_id
    WHERE ti.transaction_id = ? AND ti.quantity > 0`).all(id);

  res.json({
    id: txn.id,
    transacted_at: txn.transacted_at,
    payment_method: txn.payment_method,
    reference: txn.reference,
    customer_name: txn.customer_name || (customer ? customer.name : null),
    customer_note: txn.customer_note,
    cashier_name: txn.cashier_name,
    order_type: txn.order_type,
    tax: txn.tax,
    service_fee: txn.service_fee,
    receipt_token: tokenFor(txn.id),
    items: items.map(i => ({ item_id: i.id, product_id: i.product_id, name: i.name, quantity: i.quantity, price: i.unit_price, total: i.line_total }))
  });
});

module.exports = router;
