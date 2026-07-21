// Unguessable per-sale token for the public digital-receipt link (QR code on
// the printed receipt). Deterministic from a server-only secret + the sale
// id, so no new DB column/migration is needed and it works retroactively for
// every existing sale — nothing to backfill.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_PATH = path.join(__dirname, '..', '..', 'data', '.receipt-secret');

function loadOrCreateSecret() {
  try {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  } catch (e) {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
    return secret;
  }
}

const SECRET = loadOrCreateSecret();

function tokenFor(saleId) {
  return crypto.createHmac('sha256', SECRET).update(String(saleId)).digest('hex').slice(0, 20);
}

function verify(saleId, token) {
  if (!token) return false;
  const expected = tokenFor(saleId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { tokenFor, verify };
