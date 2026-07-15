if (!window.posTablesInit) {
  window.posTablesInit = true;
  (function () {
    const auth = typeof requireAuth === 'function' ? requireAuth() : null;
    const tableUser = document.getElementById('tableUser');
    if (auth && tableUser) {
      tableUser.textContent = `User: ${auth.name || 'User'}`;
    }

const tableGrid = document.getElementById('tableGrid');
const tableDetail = document.getElementById('tableDetail');
const tableTitle = document.getElementById('tableTitle');
const tableStatus = document.getElementById('tableStatus');
const tableOrder = document.getElementById('tableOrder');
const tableProducts = document.getElementById('tableProducts');
const clearTable = document.getElementById('clearTable');
const sendKitchen = document.getElementById('sendKitchen');
const sendPos = document.getElementById('sendPos');
const tableClock = document.getElementById('tableClock');
const tableStatusBadge = document.getElementById('tableStatus');

let tables = loadTables();
let products = [];
let activeTableId = null;

function formatCurrency(value) {
  return `Rp ${Number(value).toLocaleString('id-ID')}`;
}

function loadHeldOrdersLocal() {
  try {
    const raw = localStorage.getItem('pos_held_orders');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function saveHeldOrdersLocal(orders) {
  try {
    localStorage.setItem('pos_held_orders', JSON.stringify(orders));
  } catch (err) {}
}

function setClock() {
  if (!tableClock) return;
  const now = new Date();
  tableClock.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function renderTables() {
  tableGrid.innerHTML = '';
  tables.forEach((table) => {
    const card = document.createElement('button');
    card.className = `table-card ${table.status}`;
    card.innerHTML = `
      <div class="table-name">${table.name}</div>
      <div class="table-meta">${table.status}</div>
      <div class="table-total">${formatCurrency(tableTotal(table))}</div>
    `;
    card.addEventListener('click', () => {
      activeTableId = table.id;
      renderTables();
      renderDetail();
      try {
        localStorage.setItem('pos_selected_table', JSON.stringify({
          id: table.id,
          name: table.name
        }));
      } catch (err) {}
      if (typeof window.navigatePos === 'function') {
        window.navigatePos('/pos/ui/1/register');
      }
    });
    tableGrid.appendChild(card);
  });
}

function tableTotal(table) {
  return table.items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function renderDetail() {
  if (!tableTitle || !tableStatus || !tableOrder || !tableProducts) {
    return;
  }
  const table = tables.find((t) => t.id === activeTableId);
  if (!table) {
    tableTitle.textContent = 'Select a table';
    tableStatus.textContent = 'Status: --';
    tableOrder.innerHTML = '';
    return;
  }

  tableTitle.textContent = table.name;
  tableStatus.textContent = `Status: ${table.status}`;
  tableOrder.innerHTML = '';
  table.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'order-item';
    row.innerHTML = `
      <div class="order-item-header">
        <div class="order-item-name">${item.name}</div>
        <div>${formatCurrency(item.price * item.qty)}</div>
      </div>
      <div class="order-item-note">${formatCurrency(item.price)} × ${item.qty}</div>
      <div class="order-item-actions">
        <button class="qty-btn" data-action="dec">-</button>
        <button class="qty-btn" data-action="inc">+</button>
      </div>
    `;
    row.querySelector('[data-action="dec"]').addEventListener('click', () => updateQty(table.id, item.id, -1));
    row.querySelector('[data-action="inc"]').addEventListener('click', () => updateQty(table.id, item.id, 1));
    tableOrder.appendChild(row);
  });

  renderProducts();
}

async function fetchKitchenStatuses() {
  try {
    const response = await fetch('/api/kitchen');
    if (!response.ok) return new Map();
    const data = await response.json();
    const map = new Map();
    (data.tickets || []).forEach((ticket) => {
      if (ticket.table_label) {
        map.set(ticket.table_label, ticket.status);
      }
    });
    return map;
  } catch (err) {
    return new Map();
  }
}

async function refreshKitchenBadges() {
  const statusMap = await fetchKitchenStatuses();
  const table = tables.find((t) => t.id === activeTableId);
  if (table && tableStatusBadge) {
    const kitchenStatus = statusMap.get(table.name);
    if (kitchenStatus) {
      tableStatusBadge.textContent = `Status: ${table.status} • ${kitchenStatus}`;
    } else {
      tableStatusBadge.textContent = `Status: ${table.status}`;
    }
  }
}

function renderProducts() {
  tableProducts.innerHTML = '';
  products.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'table-product';
    btn.textContent = `${item.name} (${formatCurrency(item.price)})`;
    btn.addEventListener('click', () => addItemToTable(item));
    tableProducts.appendChild(btn);
  });
}

async function fetchProducts() {
  const response = await fetch('/api/products', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
  if (!response.ok) throw new Error('Failed to load products.');
  const data = await response.json();
  return (Array.isArray(data) ? data : []).filter((item) => item.active !== 0 && item.active !== false);
}

async function initProducts() {
  try {
    products = await fetchProducts();
  } catch (err) {
    products = loadProducts().filter((item) => item.active !== false);
  }
  renderProducts();
}

function addItemToTable(item) {
  const table = tables.find((t) => t.id === activeTableId);
  if (!table) return;
  const existing = table.items.find((row) => row.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    table.items.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
  }
  table.status = 'occupied';
  saveTables(tables);
  renderTables();
  renderDetail();
}

function updateQty(tableId, itemId, delta) {
  const table = tables.find((t) => t.id === tableId);
  if (!table) return;
  const item = table.items.find((row) => row.id === itemId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    table.items = table.items.filter((row) => row.id !== itemId);
  }
  if (!table.items.length) {
    table.status = 'available';
  }
  saveTables(tables);
  renderTables();
  renderDetail();
}

if (clearTable) {
  clearTable.addEventListener('click', () => {
    const table = tables.find((t) => t.id === activeTableId);
    if (!table) return;
    table.items = [];
    table.status = 'available';
    table.paid = false;
    table.sentToKitchen = false;
    saveTables(tables);
    renderTables();
    renderDetail();
  });
}

if (sendKitchen) {
  sendKitchen.addEventListener('click', () => {
    const table = tables.find((t) => t.id === activeTableId);
    if (!table || !table.items.length) return;
    fetch('/api/kitchen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: table.name,
        type: 'new',
        order_type: 'dine_in',
        items: table.items.map((item) => ({ name: item.name, qty: item.qty, note: item.note || '' }))
      })
    }).catch(() => {
      const kitchenOrders = loadKitchen();
      kitchenOrders.push({
        id: crypto.randomUUID(),
        table: table.name,
        items: table.items.map((item) => ({ ...item })),
        status: 'new',
        createdAt: new Date().toISOString()
      });
      saveKitchen(kitchenOrders);
    });
    table.status = 'occupied';
    table.sentToKitchen = true;
    saveTables(tables);
    renderTables();
    renderDetail();
  });
}

if (sendPos) {
  sendPos.addEventListener('click', () => {
    const table = tables.find((t) => t.id === activeTableId);
    if (!table || !table.items.length) return;
    const held = loadHeldOrdersLocal();
    const total = table.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    held.push({
      id: crypto.randomUUID(),
      label: `Table ${table.name}`,
      table_id: table.id,
      table_name: table.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total,
      items: table.items.map((item) => ({
        lineId: crypto.randomUUID(),
        id: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        discount: 0,
        modifiers: [],
        note: ''
      })),
      sentToKitchen: Boolean(table.sentToKitchen),
      orderType: 'dine_in'
    });
    saveHeldOrdersLocal(held);
    try {
      localStorage.setItem('pos_open_orders_modal', '1');
    } catch (err) {}
    if (typeof window.navigatePos === 'function') {
      window.navigatePos('/pos/ui/1/orders');
    }
  });
}

if (tableClock) {
  setClock();
  setInterval(setClock, 1000 * 30);
}
renderTables();
initProducts();
renderDetail();
refreshKitchenBadges();
setInterval(refreshKitchenBadges, 1000 * 30);

window.addEventListener('storage', (event) => {
  if (event.key === 'pos_tables' || event.key === 'pos_tables_updated') {
    tables = loadTables();
    renderTables();
    renderDetail();
  }
});

setInterval(() => {
  const fresh = loadTables();
  const current = JSON.stringify(tables);
  const next = JSON.stringify(fresh);
  if (current !== next) {
    tables = fresh;
    renderTables();
    renderDetail();
  }
}, 1000 * 5);
  })();
}
