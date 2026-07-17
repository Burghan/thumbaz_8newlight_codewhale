// Match a product string from an external POS/transaction export to a DB product.
//
// The DB keeps canonical names with dash-style variants ("Spanish Latte - Regular",
// "Americano Ice"). Transaction exports write them comma-style and inconsistently
// ("Spanish Latte, Regular", "Emerald Matcha , Ice", "air es", "Ras Matcha").
// buildProductMatcher() returns match(rawString) -> product row | null, resolving
// those differences so imports don't silently drop rows.

const VARIANT_TOKENS = new Set(['regular', 'reguler', 'ice', 'iced', 'hot', 'panas', 'dingin', 'extra', 'shot']);

// Collapse a name to a comparison key: lowercase, unify separators (comma / dash /
// slash / plus -> space), drop other punctuation, normalize "shots" -> "shot".
function canon(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\bshots\b/g, 'shot')
    .replace(/[+,\-\/&]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip trailing variant words to get a base key ("berrycano regular" -> "berrycano").
function baseKey(key) {
  return key.split(' ').filter((t) => !VARIANT_TOKENS.has(t)).join(' ').trim();
}

// Aliases keyed by canon() form -> canonical DB product name. For cases that don't
// reduce cleanly (renamed, ambiguous base, or typo'd in the export).
const ALIASES = {
  'ras matcha': 'Ras Matcha Cloud',
  'americano': 'Americano Hot',        // plain / "Regular" americano = the hot one
  'americano regular': 'Americano Hot',
  'americano ice': 'Americano Ice',
  'americano ice regular': 'Americano Ice', // "Regular" here = regular size, not the Hot variant
  // The iced-water complement is rung up four different ways in the export
  // ("air es", "aires", "air", "es") — all the one active "Air Es" product.
  // (Earlier these pointed at "Air + Es", which is inactive, so they resolved
  // to nothing and the importer auto-created junk "air"/"es" Custom products.)
  'aires': 'Air Es',
  'air es': 'Air Es',
  'air': 'Air Es',
  'es': 'Air Es',
  'air mineral botol': 'Mineral Water Botol', // renamed product, old export still uses the old name
  'newlight latte regular': 'NewLight Latte Hot', // same "Regular" = Hot convention as Americano
  'newlight latte': 'NewLight Latte Hot', // bare name is ambiguous (Hot/Ice); default Hot, same convention
};

function buildProductMatcher(db, { activeOnly = true } = {}) {
  const rows = db.prepare(
    `SELECT id, name, variant, category, is_resale, active FROM products ${activeOnly ? 'WHERE active = 1' : ''}`
  ).all();

  const exact = new Map();   // canon key -> product
  const base = new Map();    // base key -> product (null if ambiguous)
  const byName = new Map();  // canon(name) -> product, for alias resolution

  for (const p of rows) {
    byName.set(canon(p.name), p);
    const keys = new Set([canon(p.name)]);
    if (p.variant) {
      keys.add(canon(`${p.name} ${p.variant}`));
      keys.add(canon(`${p.name} - ${p.variant}`));
    }
    for (const k of keys) if (!exact.has(k)) exact.set(k, p);

    const bk = baseKey(canon(p.name));
    if (bk) {
      if (base.has(bk) && base.get(bk) && base.get(bk).id !== p.id) base.set(bk, null); // ambiguous
      else if (!base.has(bk)) base.set(bk, p);
    }
  }

  // Resolve alias targets to product rows once.
  const aliasResolved = new Map();
  for (const [k, targetName] of Object.entries(ALIASES)) {
    const p = byName.get(canon(targetName));
    if (p) aliasResolved.set(k, p);
  }

  return function match(raw) {
    const key = canon(raw);
    if (!key) return null;
    if (aliasResolved.has(key)) return aliasResolved.get(key);   // 1. alias
    if (exact.has(key)) return exact.get(key);                   // 2. exact (name / name+variant)
    const b = base.get(baseKey(key));                            // 3. variant-stripped base, if unique
    if (b) return b;
    return null;                                                 // 4. unknown
  };
}

module.exports = { buildProductMatcher, canon, baseKey };
