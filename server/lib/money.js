// Money helpers. See migrations/001_init.sql for the storage convention:
//   prices/totals   -> integer rupiah
//   unit costs      -> integer micro-rupiah (÷ 1e6 = rupiah)
const microToRupiah = (m) => (m == null ? 0 : m / 1e6);
const rupiahToMicro = (r) => Math.round(Number(r || 0) * 1e6);

// COGS/HPP per base unit is driven by the LATEST purchase price:
//   cost per base unit = last_purchase_price / conv_purchase_to_base
// Returns micro-rupiah per base unit.
function costPerBaseMicro({ last_purchase_price, conv_purchase_to_base, std_cost_per_base }) {
  const price = Number(last_purchase_price);
  const conv = Number(conv_purchase_to_base);
  if (Number.isFinite(price) && price > 0 && Number.isFinite(conv) && conv > 0) {
    return Math.round((price / conv) * 1e6);
  }
  // Fallback: a directly-entered cost per base unit (rupiah).
  return rupiahToMicro(std_cost_per_base);
}

module.exports = { microToRupiah, rupiahToMicro, costPerBaseMicro };
