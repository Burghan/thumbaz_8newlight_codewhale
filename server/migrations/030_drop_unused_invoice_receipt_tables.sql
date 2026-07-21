-- Removes two dead "sale record" systems that were never actually wired up:
-- invoices/invoice_items (migration 013) had a real API but its supposed UI
-- page was actually a misfiled copy of the Dashboard, and both tables were
-- confirmed empty (0 rows) before dropping. receipt/receipt_items never
-- existed at all despite server/routes/receipt.js querying them — that route
-- has been broken since it was written; DROP IF EXISTS here is just a
-- defensive no-op in case some other environment has stray copies.
-- The one real "invoice" concept in the app is the Payment modal's Invoice
-- checkbox, which just relabels a normal transactions row — untouched here.
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS receipt_items;
DROP TABLE IF EXISTS receipt;
