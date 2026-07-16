const express = require('express');
const db = require('../db');

const router = express.Router();

// Read the single loyalty_config row, falling back to the historical hardcoded
// defaults if the row is somehow missing. Exported so sales.js computes earn/
// redeem from the same source the setup screen edits.
function getLoyaltyConfig() {
  const row = db.prepare('SELECT earn_base, earn_points, redeem_rate, enabled, updated_at FROM loyalty_config WHERE id = 1').get();
  return row || { earn_base: 10000, earn_points: 1, redeem_rate: 100, enabled: 1, updated_at: null };
}

// GET /api/loyalty-config — staff-readable so the POS can preview points/redeem.
router.get('/', (req, res) => {
  res.json({ config: getLoyaltyConfig() });
});

// PUT /api/loyalty-config — manager-only; edits the earn/redeem rules.
router.put('/', (req, res) => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  const b = req.body || {};
  // Rupiah-per-point-earned base: must be >= 1 (0 would divide by zero).
  const earnBase = Math.floor(Number(b.earn_base));
  const earnPoints = Math.floor(Number(b.earn_points));
  const redeemRate = Math.floor(Number(b.redeem_rate));
  const enabled = b.enabled ? 1 : 0;
  if (!Number.isFinite(earnBase) || earnBase < 1) {
    return res.status(400).json({ error: 'earn_base must be at least 1' });
  }
  if (!Number.isFinite(earnPoints) || earnPoints < 0) {
    return res.status(400).json({ error: 'earn_points must be 0 or more' });
  }
  if (!Number.isFinite(redeemRate) || redeemRate < 0) {
    return res.status(400).json({ error: 'redeem_rate must be 0 or more' });
  }
  db.prepare(
    `UPDATE loyalty_config
     SET earn_base = ?, earn_points = ?, redeem_rate = ?, enabled = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(earnBase, earnPoints, redeemRate, enabled);
  res.json({ config: getLoyaltyConfig() });
});

module.exports = router;
module.exports.getLoyaltyConfig = getLoyaltyConfig;
