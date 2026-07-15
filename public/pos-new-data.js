const STORAGE = {
  products: 'pos_products',
  settings: 'pos_settings',
  tables: 'pos_tables',
  kitchen: 'pos_kitchen'
};

function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE.products);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    return [];
  }
  return [
    { id: crypto.randomUUID(), name: 'Americano', category: 'Coffee', price: 28000, active: true },
    { id: crypto.randomUUID(), name: 'Latte', category: 'Coffee', price: 32000, active: true },
    { id: crypto.randomUUID(), name: 'Matcha', category: 'Non Coffee', price: 36000, active: true }
  ];
}

function saveProducts(products) {
  localStorage.setItem(STORAGE.products, JSON.stringify(products));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE.settings);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    return null;
  }
  return {
    storeName: '8 NewLight Coffee',
    currency: 'IDR',
    // thumbaz product prices are tax-inclusive and /api/sales doesn't add tax
    // on top — keep this at 0 so the displayed total matches what's charged.
    taxRate: 0,
    orderType: 'dine_in',
    loyaltyRate: 1,
    loyaltyBase: 10000,
    receiptFooter: 'Thank you for your visit.'
  };
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
}

function loadTables() {
  try {
    const raw = localStorage.getItem(STORAGE.tables);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    return [];
  }
  const tables = Array.from({ length: 12 }, (_, idx) => ({
    id: crypto.randomUUID(),
    name: `T${idx + 1}`,
    status: 'available',
    items: [],
    sentToKitchen: false
  }));
  saveTables(tables);
  return tables;
}

function saveTables(tables) {
  localStorage.setItem(STORAGE.tables, JSON.stringify(tables));
}

function loadKitchen() {
  try {
    const raw = localStorage.getItem(STORAGE.kitchen);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    return [];
  }
  return [];
}

function saveKitchen(orders) {
  localStorage.setItem(STORAGE.kitchen, JSON.stringify(orders));
}
