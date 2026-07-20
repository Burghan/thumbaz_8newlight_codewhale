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
function wibNowIso() {
  return wibNow().toISOString();
}
function wibToday() {
  return wibNowIso().slice(0, 10);
}
function wibMonth() {
  return wibNowIso().slice(0, 7);
}

module.exports = { WIB_SQL_OFFSET, wibNow, wibNowIso, wibToday, wibMonth };
