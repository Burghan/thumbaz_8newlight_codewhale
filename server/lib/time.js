// The shop operates on WIB (Indonesia Western Time, UTC+7). Indonesia doesn't
// observe daylight saving, so a fixed offset is safe year-round.
//
// Riwayat imports write the source .xls's own local timestamps as-is (see
// server/routes/import.js) — no UTC conversion. Live writes (checkout,
// clock-in/out, purchases) must store the SAME local wall-clock basis, or a
// transaction made at, say, 2am WIB lands under the wrong calendar day
// relative to imported data and any "today"/date-range filter.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// SQLite modifier for INSERT/WHERE clauses: datetime('now', WIB_SQL_OFFSET)
const WIB_SQL_OFFSET = '+7 hours';

// A Date whose UTC-getter fields (and .toISOString()) read as WIB wall-clock
// time — the same "shift then mislabel" trick already used for stored
// timestamps, so slicing YYYY-MM-DD / YYYY-MM out of it lines up with what's
// in the database.
function wibNow() {
  return new Date(Date.now() + WIB_OFFSET_MS);
}
// Plain "YYYY-MM-DD HH:MM:SS" (matching the datetime('now', '+7 hours') SQL
// format used everywhere else) — NOT .toISOString(), which appends a literal
// 'Z'. That 'Z' claims these WIB wall-clock digits are UTC, so a client doing
// new Date(iso).toLocaleString() would apply a SECOND timezone conversion on
// top of the shift already baked in here (a real bug this shipped with —
// attendance times displayed hours off on any browser not set to UTC+0).
// Read this value back with new Date(v.replace(' ', 'T')) + local getters,
// same as every other formatDate() in this app — never toLocaleString() on
// the raw string.
function wibNowIso() {
  const d = wibNow();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function wibToday() {
  return wibNowIso().slice(0, 10);
}
function wibMonth() {
  return wibNowIso().slice(0, 7);
}

module.exports = { WIB_SQL_OFFSET, wibNow, wibNowIso, wibToday, wibMonth };
