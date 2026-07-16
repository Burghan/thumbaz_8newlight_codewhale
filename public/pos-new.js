const auth = typeof requireAuth === 'function' ? requireAuth() : null;
const userChip = document.getElementById('userChip');
const posUser = document.getElementById('posUser');
if (auth && userChip) {
  userChip.textContent = `Cashier: ${auth.name || 'User'}`;
}
if (auth && posUser) {
  posUser.textContent = auth.name || 'User';
}

const settings = loadSettings();
let products = [];
let categories = ['All'];
let posSessionId = null;
let activeEmployee = null;
let priceCheckMode = false;
let customProductId = null;
const LAST_SALE_KEY = 'pos_new_last_sale_id';

const state = {
  order: [],
  category: 'All',
  search: '',
  selectedLineId: null,
  inputMode: 'qty',
  buffer: '',
  orderLabel: '',
  currentOrderId: null,
  sentToKitchen: false,
  currentTableId: null,
  currentTableName: null,
  customerId: null,
  ordersViewSelectedId: null,
  ordersTypeFilter: ''
};
const CURRENT_ORDER_KEY = 'pos_current_order';

const categoryRow = document.getElementById('categoryRow');
const productGrid = document.getElementById('productGrid');
const orderList = document.getElementById('orderList');
const customerInput = document.getElementById('customerInput');
const loyaltyInput = document.getElementById('loyaltyInput');
const subtotalEl = document.getElementById('subtotal');
const taxEl = document.getElementById('tax');
const discountEl = document.getElementById('discount');
const loyaltyPointsEl = document.getElementById('loyaltyPoints');
const totalEl = document.getElementById('total');
const searchInput = document.getElementById('searchInput');
const clearOrder = document.getElementById('clearOrder');
const numpad = document.getElementById('numpad');
const numpadTop = document.getElementById('numpadTop');
const numpadPreActions = document.getElementById('numpadPreActions');
const numpadPostActions = document.getElementById('numpadPostActions');
const numpadFooter = document.getElementById('numpadFooter');
const payModal = document.getElementById('payModal');
const modifierModal = document.getElementById('modifierModal');
const modifierItem = document.getElementById('modifierItem');
const modifierList = document.getElementById('modifierList');
const closeModifier = document.getElementById('closeModifier');
const customModName = document.getElementById('customModName');
const customModPrice = document.getElementById('customModPrice');
const addCustomMod = document.getElementById('addCustomMod');
const splitModal = document.getElementById('splitModal');
const splitBtn = document.getElementById('splitBtn');
const closeSplit = document.getElementById('closeSplit');
const billA = document.getElementById('billA');
const billB = document.getElementById('billB');
const billATotal = document.getElementById('billATotal');
const billBTotal = document.getElementById('billBTotal');
const payNow = document.getElementById('payNow');
const closePay = document.getElementById('closePay');
const confirmPay = document.getElementById('confirmPay');
const modalTotal = document.getElementById('modalTotal');
const paymentType = document.getElementById('paymentType');
const tenderedInput = document.getElementById('tendered');
const changeValue = document.getElementById('changeValue');
const paymentCustomerBtn = document.getElementById('paymentCustomerBtn');
const paymentCustomerName = document.getElementById('paymentCustomerName');
const invoiceCheck = document.getElementById('invoiceCheck');
const clock = document.getElementById('clock');
const orderTypeSelect = document.getElementById('orderType');
const loyaltyBtn = document.getElementById('loyaltyBtn');
const flowTabs = document.querySelectorAll('.flow-tab');
const registerView = document.getElementById('registerView');
const ordersView = document.getElementById('ordersView');
const tablesView = document.getElementById('tablesView');
const posOrdersList = document.getElementById('posOrdersList');
const posOrdersSearch = document.getElementById('posOrdersSearch');
const posOrdersFilter = document.getElementById('posOrdersFilter');
const posOrdersTypeChips = document.getElementById('posOrdersTypeChips');
const posOrderTitle = document.getElementById('posOrderTitle');
const posOrderMeta = document.getElementById('posOrderMeta');
const posOrderStatus = document.getElementById('posOrderStatus');
const posOrderItems = document.getElementById('posOrderItems');
const posOrderSubtotal = document.getElementById('posOrderSubtotal');
const posOrderTax = document.getElementById('posOrderTax');
const posOrderTotal = document.getElementById('posOrderTotal');
const posOrderAction = document.getElementById('posOrderAction');
const orderMetaLine = document.getElementById('orderMetaLine');
const promptModal = document.getElementById('promptModal');
const promptTitle = document.getElementById('promptTitle');
const promptHint = document.getElementById('promptHint');
const promptLabel = document.getElementById('promptLabel');
const promptInput = document.getElementById('promptInput');
const promptSave = document.getElementById('promptSave');
const promptCancel = document.getElementById('promptCancel');
const promptClose = document.getElementById('promptClose');
const infoModal = document.getElementById('infoModal');
const infoTitle = document.getElementById('infoTitle');
const infoMessage = document.getElementById('infoMessage');
const infoOk = document.getElementById('infoOk');
const infoClose = document.getElementById('infoClose');
let promptHandler = null;
const actionsModal = document.getElementById('actionsModal');
const closeActions = document.getElementById('closeActions');
const actionsGrid = document.getElementById('actionsGrid');
const receiptModal = document.getElementById('receiptModal');
const receiptTotal = document.getElementById('receiptTotal');
const receiptTotal2 = document.getElementById('receiptTotal2');
const receiptSubtotal = document.getElementById('receiptSubtotal');
const receiptTax = document.getElementById('receiptTax');
const receiptChangeLine = document.getElementById('receiptChangeLine');
const receiptChange = document.getElementById('receiptChange');
const receiptTitle = document.getElementById('receiptTitle');
const receiptTicket = document.getElementById('receiptTicket');
const receiptTime = document.getElementById('receiptTime');
const receiptCashier = document.getElementById('receiptCashier');
const receiptOrderType = document.getElementById('receiptOrderType');
const receiptCustomer = document.getElementById('receiptCustomer');
const receiptItems = document.getElementById('receiptItems');
const receiptFooterText = document.getElementById('receiptFooterText');
const receiptLogoImg = document.getElementById('receiptLogoImg');
const receiptLogoText = document.getElementById('receiptLogoText');
const receiptQr = document.getElementById('receiptQr');
const printReceipt = document.getElementById('printReceipt');
const sendReceipt = document.getElementById('sendReceipt');
const receiptEmail = document.getElementById('receiptEmail');
const newOrder = document.getElementById('newOrder');
const payTile = document.getElementById('payTile');
const cashMoveBtn = document.getElementById('cashMoveBtn');
const ordersBtn = document.getElementById('ordersBtn');
const ordersBadge = document.getElementById('ordersBadge');
const cashMoveModal = document.getElementById('cashMoveModal');
const cashMoveIn = document.getElementById('cashMoveIn');
const cashMoveOut = document.getElementById('cashMoveOut');
const closeCashMove = document.getElementById('closeCashMove');
const sendOrderBtn = document.getElementById('sendOrderBtn');
const closeSessionModal = document.getElementById('closeSessionModal');
const closeSessionSubhead = document.getElementById('closeSessionSubhead');
const closeSessionClose = document.getElementById('closeSessionClose');
const closeSessionCancel = document.getElementById('closeSessionCancel');
const closeSessionConfirm = document.getElementById('closeSessionConfirm');
const expectedCash = document.getElementById('expectedCash');
const expectedCard = document.getElementById('expectedCard');
const expectedQris = document.getElementById('expectedQris');
const expectedBreakdown = document.getElementById('expectedBreakdown');
const countedCash = document.getElementById('countedCash');
const countedCard = document.getElementById('countedCard');
const countedQris = document.getElementById('countedQris');
const closeSessionNotes = document.getElementById('closeSessionNotes');
const customerModal = document.getElementById('customerModal');
const closeCustomerModal = document.getElementById('closeCustomerModal');
const customerSearch = document.getElementById('customerSearch');
const customerList = document.getElementById('customerList');
const customerCreateName = document.getElementById('customerCreateName');
const customerCreateMemberId = document.getElementById('customerCreateMemberId');
const customerCreatePhone = document.getElementById('customerCreatePhone');
const customerCreateEmail = document.getElementById('customerCreateEmail');
const createCustomer = document.getElementById('createCustomer');
const clearCustomer = document.getElementById('clearCustomer');
const priceCheckBtn = document.getElementById('priceCheckBtn');
const addCustomItemBtn = document.getElementById('addCustomItemBtn');
const manageModifiersBtn = document.getElementById('manageModifiersBtn');
const manageModifiersModal = document.getElementById('manageModifiersModal');
const closeManageModifiers = document.getElementById('closeManageModifiers');
const manageModifierList = document.getElementById('manageModifierList');
const newModifierName = document.getElementById('newModifierName');
const newModifierPrice = document.getElementById('newModifierPrice');
const createModifierBtn = document.getElementById('createModifierBtn');
const mobileCartToggle = document.getElementById('mobileCartToggle');
const mobileCartCount = document.getElementById('mobileCartCount');
const mobileCartTotal = document.getElementById('mobileCartTotal');
const orderPanelEl = document.querySelector('.order-panel');

function loadHeldOrders() {
  try {
    const raw = localStorage.getItem('pos_held_orders');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveHeldOrders(orders) {
  localStorage.setItem('pos_held_orders', JSON.stringify(orders));
}

function updateOrdersBadge() {
  if (!ordersBadge) return;
  const count = loadHeldOrders().length;
  ordersBadge.textContent = String(count);
  ordersBadge.style.display = count ? '' : 'none';
  if (ordersView && !ordersView.classList.contains('hidden')) {
    renderOrdersView();
  }
}

function loadKitchenStatusMap() {
  try {
    const raw = localStorage.getItem('pos_kitchen_status');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function getKitchenStatusKey(orderId, tableLabel) {
  if (orderId) return `order:${orderId}`;
  if (tableLabel) return `table:${String(tableLabel).trim().toLowerCase()}`;
  return null;
}

function showRegisterView() {
  registerView?.classList.remove('hidden');
  ordersView?.classList.add('hidden');
  tablesView?.classList.add('hidden');
}

function showOrdersView() {
  ordersView?.classList.remove('hidden');
  registerView?.classList.add('hidden');
  tablesView?.classList.add('hidden');
  renderOrdersView();
}

function showTablesView() {
  tablesView?.classList.remove('hidden');
  registerView?.classList.add('hidden');
  ordersView?.classList.add('hidden');
}

function navigatePos(path, replace = false) {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  handlePosRoute();
}

window.navigatePos = navigatePos;

function handlePosRoute() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const uiIndex = parts.indexOf('ui');
  const route = uiIndex >= 0 ? parts.slice(uiIndex + 2) : [];
  const section = route[0] || 'register';
  if (section === 'orders') {
    showOrdersView();
    flowTabs.forEach((item) => item.classList.toggle('active', item.dataset.flow === 'orders'));
    return;
  }
  if (section === 'tables') {
    showTablesView();
    flowTabs.forEach((item) => item.classList.toggle('active', item.dataset.flow === 'tables'));
    return;
  }
  if (section === 'direct') {
    setOrderType('takeaway');
    state.currentTableId = null;
    state.currentTableName = null;
    state.orderLabel = 'Direct Sale';
    setOrderMeta();
    showRegisterView();
    flowTabs.forEach((item) => item.classList.toggle('active', item.dataset.flow === 'direct'));
    return;
  }
  try {
    const raw = localStorage.getItem('pos_selected_table');
    if (raw) {
      const payload = JSON.parse(raw);
      localStorage.removeItem('pos_selected_table');
      if (payload?.id && payload?.name) {
        state.currentTableId = payload.id;
        state.currentTableName = payload.name;
        state.orderLabel = `Table ${payload.name}`;
        setOrderMeta();
      }
    }
  } catch (err) {}
  showRegisterView();
  flowTabs.forEach((item) => item.classList.toggle('active', item.dataset.flow === 'register'));
}

function loadOrderIntoRegister(order) {
  state.order = order.items || [];
  state.selectedLineId = state.order[0]?.lineId || null;
  state.buffer = '';
  state.orderLabel = order.label || '';
  state.currentOrderId = order.id || null;
  state.sentToKitchen = Boolean(order.sentToKitchen);
  state.currentTableId = order.table_id || null;
  state.currentTableName = order.table_name || null;
  if (orderTypeSelect) {
    orderTypeSelect.value = order.orderType || order.order_type || settings.orderType || 'dine_in';
    orderTypeSelect.dispatchEvent(new Event('change'));
  }
  setOrderMeta();
  renderOrder();
  showRegisterView();
}

async function renderOrdersView() {
  if (!posOrdersList) return;
  const held = loadHeldOrders();
  const query = String(posOrdersSearch?.value || '').toLowerCase();
  const filter = String(posOrdersFilter?.value || '');
  const typeFilter = state.ordersTypeFilter || '';
  let kitchenTickets = [];
  const kitchenStatusMap = loadKitchenStatusMap();
  try {
    const response = await fetch('/api/kitchen');
    if (response.ok) {
      const data = await response.json();
      kitchenTickets = Array.isArray(data.tickets) ? data.tickets : [];
    }
  } catch (err) {
    kitchenTickets = [];
  }
  const normalizeLabel = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^table\s*/i, '')
    .replace(/[^a-z0-9]/g, '');
  let heldChanged = false;
  const rows = held
    .filter((order) => {
      const status = order.status || 'ongoing';
      if (filter && status !== filter) return false;
      if (typeFilter && order.orderType !== typeFilter) return false;
      if (!query) return true;
      return [order.label, order.customerName, order.receiptNumber, status]
        .some((value) => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

  posOrdersList.innerHTML = '';
  if (!rows.length) {
    posOrdersList.innerHTML = '<div class="orders-empty">No orders found.</div>';
    if (posOrderTitle) posOrderTitle.textContent = 'Select an order';
    if (posOrderMeta) posOrderMeta.textContent = '--';
    if (posOrderItems) posOrderItems.innerHTML = '';
    if (posOrderSubtotal) posOrderSubtotal.textContent = formatCurrency(0);
    if (posOrderTax) posOrderTax.textContent = formatCurrency(0);
    if (posOrderTotal) posOrderTotal.textContent = formatCurrency(0);
    if (posOrderStatus) posOrderStatus.className = 'status-pill ongoing hidden';
    if (posOrderAction) {
      posOrderAction.textContent = 'Load Order';
      posOrderAction.disabled = true;
      posOrderAction.onclick = null;
    }
    return;
  }

  rows.forEach((order) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'orders-row';
    if (state.ordersViewSelectedId === order.id) row.classList.add('active');
    const statusText = order.status === 'paid' ? 'Receipt' : order.status === 'invoice' ? 'Invoice' : 'Ongoing';
    const statusClass = order.status === 'paid' ? 'paid' : order.status === 'invoice' ? 'invoice' : 'ongoing';
    const createdAt = new Date(order.createdAt || Date.now());
    const dateLabel = createdAt.toLocaleDateString('en-US');
    const timeLabel = createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const orderRef = order.receiptNumber || '-';
    const detailRef = [
      order.customerName || null,
      orderRef || null
    ].filter(Boolean).join(' / ');
    const orderLabel = normalizeLabel(order.label || '');
    const kitchenTicket = kitchenTickets.find((ticket) => {
      if (ticket.order_id && ticket.order_id === order.id) return true;
      if (ticket.table_label && orderLabel) {
        const tableLabel = normalizeLabel(ticket.table_label);
        return tableLabel === orderLabel || tableLabel.endsWith(orderLabel) || orderLabel.endsWith(tableLabel);
      }
      return false;
    });
    const localKey = getKitchenStatusKey(order.id, order.table_name || order.label);
    const localStatus = localKey ? kitchenStatusMap[localKey] : null;
    const kitchenStatusRaw = String(kitchenTicket?.status || '').toLowerCase();
    const kitchenStatusFromTicket = kitchenTicket?.status;
    const kitchenStatusResolved = kitchenStatusFromTicket || localStatus;
    const normalizedKitchenStatus = String(kitchenStatusResolved || '').toLowerCase();
    const kitchenStatus = normalizedKitchenStatus === 'serve' || normalizedKitchenStatus === 'served'
      ? 'Served'
      : kitchenStatusResolved;
    if (kitchenStatus && kitchenStatus !== order.kitchenStatus) {
      order.kitchenStatus = kitchenStatus;
      heldChanged = true;
    }
    const finalKitchenStatus = kitchenStatus || order.kitchenStatus;
    row.innerHTML = `
      <div class="orders-row-left">
        <div class="orders-row-date">${dateLabel}</div>
        <div class="orders-row-time">${timeLabel}</div>
      </div>
      <div class="orders-row-center">
        <div class="orders-row-title">${order.label || 'Order'}</div>
        <div class="orders-row-ref">${detailRef || '-'}</div>
        <div class="orders-row-tags">
          <span class="type-pill">${formatOrderType(order.orderType || 'dine_in')}</span>
          ${finalKitchenStatus ? `<span class="kitchen-pill">${finalKitchenStatus}</span>` : ''}
        </div>
      </div>
      <div class="orders-row-right">
        <div class="orders-row-total">${formatCurrency(order.total || 0)}</div>
        <span class="status-pill ${statusClass}">${statusText}</span>
      </div>
    `;
    row.addEventListener('click', () => {
      state.ordersViewSelectedId = order.id;
      renderOrdersView();
      renderOrdersDetail(order);
    });
    posOrdersList.appendChild(row);
  });

  if (heldChanged) {
    saveHeldOrders(held);
  }

  const selected = rows.find((order) => order.id === state.ordersViewSelectedId) || rows[0];
  state.ordersViewSelectedId = selected?.id || null;
  if (selected) renderOrdersDetail(selected);
}

function renderOrdersDetail(order) {
  if (!order) return;
  const totals = calculateTotalsForItems(order.items || []);
  const statusText = order.status === 'paid' ? 'Receipt' : order.status === 'invoice' ? 'Invoice' : 'Ongoing';
  const statusClass = order.status === 'paid' ? 'paid' : order.status === 'invoice' ? 'invoice' : 'ongoing';

  if (posOrderTitle) posOrderTitle.textContent = order.label || 'Order';
  if (posOrderMeta) {
    const meta = [order.customerName, order.receiptNumber].filter(Boolean).join(' • ');
    posOrderMeta.textContent = meta || '--';
  }
  if (posOrderStatus) {
    posOrderStatus.textContent = statusText;
    posOrderStatus.className = `status-pill ${statusClass}`;
  }
  if (posOrderItems) {
    posOrderItems.innerHTML = (order.items || []).map((item) => `
      <div class="orders-detail-item">
        <span>${item.qty}× ${item.name}</span>
        <span>${formatCurrency(item.price * item.qty)}</span>
      </div>
    `).join('');
  }
  if (posOrderSubtotal) posOrderSubtotal.textContent = formatCurrency(totals.subtotal);
  if (posOrderTax) posOrderTax.textContent = formatCurrency(totals.tax);
  if (posOrderTotal) posOrderTotal.textContent = formatCurrency(totals.total);

  if (posOrderAction) {
    const isPaid = order.status === 'paid' || order.status === 'invoice';
    posOrderAction.disabled = false;
    posOrderAction.textContent = isPaid ? `View ${order.status === 'invoice' ? 'Invoice' : 'Receipt'}` : 'Load Order';
    posOrderAction.onclick = () => {
      if (isPaid) {
        openReceiptFromHeld(order);
      } else {
        loadOrderIntoRegister(order);
      }
    };
  }
}

function sendOrderToKitchen(label, items, type = 'new', orderId = null) {
  if (!items || !items.length) return;
  const id = orderId || crypto.randomUUID();
  const payload = {
    order_id: id,
    type,
    table: label || 'Direct Sale',
    order_type: getOrderTypeValue(),
    items: items.map((item) => ({
      productId: item.id,
      name: item.name,
      qty: item.qty,
      variantId: item.variantId || null,
      note: item.note || ''
    }))
  };
  fetch('/api/kitchen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then((res) => {
      if (!res.ok) throw new Error();
    })
    .catch(() => {
      openInfo('Not sent', 'Couldn\'t reach the kitchen screen — check the ticket on /kitchen.html manually.');
    });
  return id;
}

function formatCurrency(value) {
  const currency = settings.currency || 'IDR';
  if (currency === 'IDR') {
    return `Rp ${Number(value).toLocaleString('id-ID')}`;
  }
  return `${currency} ${Number(value).toFixed(2)}`;
}

function parseAmount(value) {
  const text = String(value || '').trim().replace(/,/g, '.');
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

function getOrderTypeValue() {
  return orderTypeSelect?.value || settings.orderType || 'dine_in';
}

function formatOrderType(value) {
  const text = String(value || '').trim();
  if (text === 'takeaway') return 'Takeaway';
  if (text === 'delivery') return 'Delivery';
  return 'Dine In';
}

function setOrderType(value) {
  if (orderTypeSelect) {
    orderTypeSelect.value = value;
  }
  if (!numpadTop) return;
  const map = {
    dine_in: '[data-action="dine"]',
    takeaway: '[data-action="takeaway"]',
    delivery: '[data-action="delivery"]'
  };
  const selector = map[value] || map.dine_in;
  const target = numpadTop.querySelector(selector);
  if (!target) return;
  numpadTop.querySelectorAll('.numpad-chip').forEach((chip) => chip.classList.remove('active'));
  target.classList.add('active');
}

function setClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  clock.textContent = time;
}

function renderCategories() {
  categoryRow.innerHTML = '';
  categories.forEach((cat, index) => {
    const chip = document.createElement('button');
    chip.className = `category-chip category-${(index % 5) + 1}`;
    if (state.category === cat) chip.classList.add('active');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.category = cat;
      renderCategories();
      renderProducts();
    });
    categoryRow.appendChild(chip);
  });
}

function renderProducts() {
  productGrid.innerHTML = '';
  const filtered = products.filter((item) => {
    const matchesCategory = !state.category || item.category === state.category;
    const matchesSearch = item.name.toLowerCase().includes(state.search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  filtered.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    const qty = state.order.reduce((sum, row) => (row.id === item.id ? sum + row.qty : sum), 0);
    card.innerHTML = `
      <div class="product-thumb">${item.name.slice(0, 2).toUpperCase()}</div>
      <div class="product-name">${item.name}</div>
      <div class="product-price">${formatCurrency(item.price)}</div>
      ${qty ? `<span class="product-badge">${qty}</span>` : ''}
    `;
    card.addEventListener('click', () => addToOrder(item));
    productGrid.appendChild(card);
  });
}

async function fetchProducts() {
  // thumbaz's /api/products returns a bare array of {id,name,category,price,active,...}
  // (the old coffee-pos prototype expected {products:[...]} with pos_ok/product_type
  // flags that don't exist here).
  const response = await fetch('/api/products', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
  if (!response.ok) throw new Error('Failed to load products.');
  const data = await response.json();
  return (Array.isArray(data) ? data : []).filter((item) => item.active !== 0 && item.active !== false);
}

async function initProducts() {
  try {
    products = await fetchProducts();
    if (!products.length) {
      products = loadProducts().filter((item) => item.active !== false);
    }
  } catch (err) {
    products = loadProducts().filter((item) => item.active !== false);
  }
  // No "All" chip — categories are the real product categories only. Default
  // the active filter to the first category so a real one is selected on load.
  categories = Array.from(new Set(products.map((item) => item.category))).filter(Boolean);
  if (state.category === 'All' || !categories.includes(state.category)) {
    state.category = categories[0] || '';
  }
  const customProduct = products.find((p) => String(p.name || '').toLowerCase() === 'custom item');
  customProductId = customProduct ? Number(customProduct.id) : null;
  renderCategories();
  renderProducts();
}

// Clock/shift gate — mirrors pos.html's loadActiveEmployee(). thumbaz's
// /api/clock/status is currently a stub that always responds 200, so in
// practice this just waits for that first check before allowing a sale
// (real per-shift gating will tighten this once /api/clock/status is real).
function loadActiveEmployee() {
  if (!auth) return;
  fetch('/api/clock/status', { headers: typeof authHeaders === 'function' ? authHeaders() : {} })
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then(() => {
      activeEmployee = auth;
    })
    .catch(() => {
      activeEmployee = auth;
    });
}

function addToOrder(item) {
  if (priceCheckMode) {
    priceCheckMode = false;
    openInfo(item.name, formatCurrency(item.price));
    return;
  }
  const existing = state.order.find((row) => row.id === item.id);
  if (existing) {
    existing.qty += 1;
    state.selectedLineId = existing.lineId;
  } else {
    const line = {
      lineId: crypto.randomUUID(),
      id: item.id,
      name: item.name,
      price: item.price,
      qty: 1,
      note: '',
      discount: 0,
      modifiers: []
    };
    state.order.push(line);
    state.selectedLineId = line.lineId;
  }
  state.lastAddedCategory = item.category || 'Drinks';
  state.buffer = '';
  renderOrder();
}

function updateQty(lineId, delta) {
  const row = state.order.find((item) => item.lineId === lineId);
  if (!row) return;
  row.qty += delta;
  if (row.qty <= 0) {
    state.order = state.order.filter((item) => item.lineId !== lineId);
    state.selectedLineId = state.order[0]?.lineId || null;
  }
  renderOrder();
}

function applyBufferToSelected() {
  if (!state.selectedLineId) return;
  const row = state.order.find((item) => item.lineId === state.selectedLineId);
  if (!row) return;
  const value = parseAmount(state.buffer);
  if (state.inputMode === 'qty') {
    row.qty = value > 0 ? value : 1;
  } else if (state.inputMode === 'price') {
    row.price = value > 0 ? value : row.price;
  } else if (state.inputMode === 'disc') {
    row.discount = Math.min(100, Math.max(0, value));
  }
  renderOrder();
}

function renderOrder() {
  orderList.innerHTML = '';
  state.order.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'order-item';
    if (state.selectedLineId === item.lineId) {
      row.classList.add('selected');
    }
    const modsTotal = item.modifiers.reduce((sum, mod) => sum + Number(mod.price || 0), 0);
    const lineTotal = (item.price + modsTotal) * item.qty * (1 - item.discount / 100);
    row.innerHTML = `
      <div class="order-item-header">
        <div class="order-item-name">${item.name}</div>
        <div>${formatCurrency(lineTotal)}</div>
      </div>
      <div class="order-item-note">${formatCurrency(item.price)} × ${item.qty} ${item.discount ? `• ${item.discount}% off` : ''}</div>
      ${item.course ? `<div class="order-item-note">Course: ${item.course}</div>` : ''}
      ${item.modifiers.map((mod) => `<div class=\"order-item-note\">• ${mod.name} (${formatCurrency(mod.price)})</div>`).join('')}
      ${item.note ? `<div class="order-item-note">${item.note}</div>` : ''}
      <div class="order-item-actions">
        <div class="qty-stepper">
          <button class="qty-btn" data-action="dec" aria-label="Decrease quantity">−</button>
          <span class="qty-count">${item.qty}</span>
          <button class="qty-btn" data-action="inc" aria-label="Increase quantity">+</button>
        </div>
        <button class="qty-btn ghost" data-action="mod">Mods</button>
      </div>
    `;
    row.addEventListener('click', () => {
      state.selectedLineId = item.lineId;
      renderOrder();
    });
    row.querySelector('[data-action="dec"]').addEventListener('click', (event) => {
      event.stopPropagation();
      updateQty(item.lineId, -1);
    });
    row.querySelector('[data-action="inc"]').addEventListener('click', (event) => {
      event.stopPropagation();
      updateQty(item.lineId, 1);
    });
    row.querySelector('[data-action="mod"]').addEventListener('click', (event) => {
      event.stopPropagation();
      state.selectedLineId = item.lineId;
      openModifierModal(item);
    });
    orderList.appendChild(row);
  });
  updateTotals();
  saveCurrentOrderState();

  const hasItems = state.order.length > 0;
  const showNumpad = hasItems && !state.sentToKitchen;
  numpad?.classList.toggle('hidden', !showNumpad);
  numpadFooter?.classList.toggle('hidden', !hasItems);
  numpadPreActions?.classList.toggle('hidden', hasItems);
  numpadPostActions?.classList.toggle('hidden', !hasItems);
  if (sendOrderBtn) {
    if (state.sentToKitchen) {
      sendOrderBtn.textContent = 'New';
      sendOrderBtn.dataset.action = 'new_order';
      sendOrderBtn.classList.remove('send');
    } else {
      sendOrderBtn.textContent = 'Send to Bar';
      sendOrderBtn.dataset.action = 'update_kitchen';
      sendOrderBtn.classList.add('send');
    }
  }
}

function saveCurrentOrderState() {
  try {
    if (!state.order.length) {
      localStorage.removeItem(CURRENT_ORDER_KEY);
      return;
    }
    const payload = {
      label: state.orderLabel || '',
      items: state.order,
      sentToKitchen: state.sentToKitchen,
      orderType: getOrderTypeValue()
    };
    localStorage.setItem(CURRENT_ORDER_KEY, JSON.stringify(payload));
  } catch (err) {}
}

function calculateTotals() {
  const subtotal = state.order.reduce((sum, item) => {
    const mods = item.modifiers.reduce((acc, mod) => acc + Number(mod.price || 0), 0);
    return sum + (item.price + mods) * item.qty;
  }, 0);
  const discount = state.order.reduce((sum, item) => {
    const mods = item.modifiers.reduce((acc, mod) => acc + Number(mod.price || 0), 0);
    return sum + ((item.price + mods) * item.qty * item.discount) / 100;
  }, 0);
  const taxRate = Number(settings.taxRate || 0);
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  return { subtotal, discount, tax, total };
}

function calculateTotalsForItems(items) {
  const subtotal = items.reduce((sum, item) => {
    const mods = (item.modifiers || []).reduce((acc, mod) => acc + Number(mod.price || 0), 0);
    return sum + (item.price + mods) * item.qty;
  }, 0);
  const discount = items.reduce((sum, item) => {
    const mods = (item.modifiers || []).reduce((acc, mod) => acc + Number(mod.price || 0), 0);
    return sum + ((item.price + mods) * item.qty * (item.discount || 0)) / 100;
  }, 0);
  const taxRate = Number(settings.taxRate || 0);
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  return { subtotal, discount, tax, total };
}

function updateTotals() {
  const totals = calculateTotals();
  const { subtotal, discount, tax, total } = totals;
  subtotalEl.textContent = formatCurrency(subtotal);
  discountEl.textContent = formatCurrency(discount);
  if (taxEl) taxEl.textContent = formatCurrency(tax);
  totalEl.textContent = formatCurrency(total);
  modalTotal.textContent = formatCurrency(total);
  if (loyaltyPointsEl) {
    const base = Number(settings.loyaltyBase || 10000);
    const rate = Number(settings.loyaltyRate || 1);
    const points = base > 0 ? Math.floor(total / base) * rate : 0;
    loyaltyPointsEl.textContent = String(points);
  }
  if (mobileCartCount && mobileCartTotal) {
    const itemCount = state.order.reduce((sum, item) => sum + item.qty, 0);
    mobileCartCount.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    mobileCartTotal.textContent = formatCurrency(total);
  }
}

function updateChangeDisplay() {
  if (!changeValue || !tenderedInput) return;
  const totals = calculateTotals();
  const method = paymentType?.value || 'cash';
  const wantsInvoice = Boolean(invoiceCheck?.checked);
  if (method !== 'cash') {
    changeValue.textContent = formatCurrency(0);
    return;
  }
  const tendered = parseAmount(tenderedInput.value);
  const change = Math.max(0, tendered - totals.total);
  changeValue.textContent = formatCurrency(change);
}

function resetOrderState() {
  state.order = [];
  state.selectedLineId = null;
  state.buffer = '';
  state.orderLabel = '';
  state.currentOrderId = null;
  state.sentToKitchen = false;
  state.lastAddedCategory = null;
  setOrderMeta();
  renderOrder();
}

function openReceiptFromHeld(order) {
  if (!order || !receiptModal) return;
  const isInvoice = Boolean(order.isInvoice || order.status === 'invoice');
  const ticket = order.receiptNumber || (isInvoice ? `INV-${Date.now().toString().slice(-6)}` : `RCPT-${Date.now().toString().slice(-6)}`);
  const totals = calculateTotalsForItems(order.items || []);
  // Scannable receipt code — plain-text summary (ticket/total/date), not a
  // link, since there's no digital receipt page to link to yet.
  const receiptLink = `${ticket}\n${formatCurrency(totals.total)}\n${new Date(order.paidAt || order.updatedAt || Date.now()).toLocaleString('id-ID')}`;
  const qrImageUrl = `/api/qr?text=${encodeURIComponent(receiptLink)}&format=png&ts=${Date.now()}`;
  if (receiptItems) {
    receiptItems.innerHTML = (order.items || []).map((item) => {
      const mods = item.modifiers?.map((mod) => ` + ${mod.name}`).join('') || '';
      const note = item.note ? `<div class="receipt-note">Note: ${item.note}</div>` : '';
      return `
        <div class="receipt-item">
          <div>${item.qty}x</div>
          <div>
            <div class="name">${item.name}${mods}</div>
            <div class="sub">${formatCurrency(item.price)} / unit</div>
            ${note}
          </div>
          <div>${formatCurrency(item.price * item.qty)}</div>
        </div>
      `;
    }).join('');
  }
  if (receiptTotal) receiptTotal.textContent = formatCurrency(totals.total);
  if (receiptTotal2) receiptTotal2.textContent = formatCurrency(totals.total);
  if (receiptSubtotal) receiptSubtotal.textContent = formatCurrency(totals.subtotal);
  if (receiptTax) receiptTax.textContent = formatCurrency(totals.tax);
  if (receiptChangeLine) receiptChangeLine.style.display = 'none';
  if (receiptTitle) receiptTitle.textContent = isInvoice ? 'Invoice' : 'Receipt';
  if (receiptTicket) receiptTicket.textContent = `${isInvoice ? 'Invoice' : 'Receipt'} ${ticket}`;
  if (receiptOrderType) receiptOrderType.textContent = `Order Type: ${formatOrderType(order.orderType || 'dine_in')}`;
  if (receiptTime) {
    const time = order.paidAt || order.updatedAt || order.createdAt;
    receiptTime.textContent = time ? new Date(time).toLocaleString('id-ID') : '--';
  }
  if (receiptCashier) receiptCashier.textContent = `Served by: ${auth?.name || 'Cashier'}`;
  if (receiptFooterText) receiptFooterText.textContent = settings.receiptFooter || 'Thank you!';
  if (receiptQr) receiptQr.src = qrImageUrl;
  if (receiptCustomer) {
    if (isInvoice && order.customerName) {
      receiptCustomer.textContent = `Customer: ${order.customerName}`;
      receiptCustomer.classList.remove('hidden');
    } else {
      receiptCustomer.classList.add('hidden');
    }
  }
  payModal.classList.remove('active');
  receiptModal.classList.add('active');
}

function updatePaymentCustomerLabel() {
  if (!paymentCustomerName) return;
  const name = customerInput?.value.trim();
  paymentCustomerName.textContent = name || 'Customer';
}

function openPayModal() {
  payModal.classList.add('active');
  if (invoiceCheck) invoiceCheck.checked = false;
  updateChangeDisplay();
  updatePaymentCustomerLabel();
}

searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderProducts();
});

function openNote() {
  const row = state.order.find((item) => item.lineId === state.selectedLineId);
  if (!row) {
    openInfo('No item selected', 'Select an item first.');
    return;
  }
  openPrompt({
    title: 'Customer Note',
    label: 'Note',
    value: row.note || '',
    placeholder: 'Add a note',
    onSave: (value) => {
      row.note = value.trim();
      renderOrder();
    }
  });
}

if (cashMoveBtn) {
  cashMoveBtn.addEventListener('click', () => cashMoveModal?.classList.add('active'));
}

if (ordersBtn) {
  ordersBtn.addEventListener('click', () => {
    navigatePos('/pos/ui/1/orders');
  });
}

if (cashMoveIn) {
  cashMoveIn.addEventListener('click', () => {
    cashMoveModal?.classList.remove('active');
    openCashMove('in');
  });
}

if (cashMoveOut) {
  cashMoveOut.addEventListener('click', () => {
    cashMoveModal?.classList.remove('active');
    openCashMove('out');
  });
}

closeCashMove?.addEventListener('click', () => cashMoveModal?.classList.remove('active'));
cashMoveModal?.addEventListener('click', (event) => {
  if (event.target === cashMoveModal) cashMoveModal.classList.remove('active');
});

function handleSetTable() {
  openPrompt({
    title: 'Set Table',
    label: 'Table number / name',
    value: state.orderLabel ? state.orderLabel.replace(/^Table\s*/i, '') : '',
    placeholder: 'e.g. T12',
    onSave: (value) => {
      const trimmed = value.trim();
      state.orderLabel = trimmed ? `Table ${trimmed}` : '';
      if (orderTypeSelect) orderTypeSelect.value = 'dine_in';
      setOrderMeta();
    }
  });
}

function upsertHeldOrder(orderId, {
  label,
  sentToKitchen,
  status,
  receiptNumber,
  isInvoice,
  customerName,
  orderType,
  total,
  items
} = {}) {
  const held = loadHeldOrders();
  const resolvedItems = items || state.order;
  const totals = typeof total === 'number' ? { total } : calculateTotalsForItems(resolvedItems);
  const resolvedTotal = typeof total === 'number' ? total : totals.total;
  const resolvedLabel = label || state.orderLabel || `Tab ${held.length + 1}`;
  const existingIndex = held.findIndex((item) => item.id === orderId);
  const existing = existingIndex >= 0 ? held[existingIndex] : null;
  const payload = {
    id: orderId,
    label: resolvedLabel,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    total: resolvedTotal,
    items: resolvedItems,
    sentToKitchen: sentToKitchen ?? state.sentToKitchen,
    status: status || existing?.status || (sentToKitchen ? 'ongoing' : 'draft'),
    orderType: orderType || existing?.orderType || getOrderTypeValue(),
    receiptNumber: receiptNumber ?? existing?.receiptNumber ?? null,
    isInvoice: isInvoice ?? existing?.isInvoice ?? false,
    customerName: customerName ?? existing?.customerName ?? null,
    paidAt: existing?.paidAt || null
  };
  if (existingIndex >= 0) {
    held[existingIndex] = payload;
  } else {
    held.push(payload);
  }
  saveHeldOrders(held);
  updateOrdersBadge();
  return payload;
}

function handleSetTab() {
  if (!state.order.length) {
    openInfo('No items', 'No items to save.');
    return;
  }
  const orderId = state.currentOrderId || crypto.randomUUID();
  const type = state.sentToKitchen ? 'update' : 'new';
  const payload = upsertHeldOrder(orderId, { sentToKitchen: true, status: 'ongoing' });
  state.currentOrderId = sendOrderToKitchen(payload.label, state.order, type, orderId) || orderId;
  state.sentToKitchen = true;
  state.order = [];
  state.selectedLineId = null;
  state.buffer = '';
  state.orderLabel = '';
  state.currentOrderId = null;
  state.sentToKitchen = false;
  setOrderMeta();
  renderOrder();
  openInfo('Sent', 'Order sent to kitchen.');
}

function setOrderMeta() {
  if (!orderMetaLine) return;
  if (state.orderLabel) {
    orderMetaLine.textContent = state.orderLabel;
    return;
  }
  orderMetaLine.textContent = 'Ticket #1024';
}

function openPrompt({ title, label, value, placeholder, hint, onSave }) {
  if (!promptModal) return;
  promptTitle.textContent = title || 'Edit';
  promptHint.textContent = hint || '';
  promptLabel.textContent = label || 'Value';
  promptInput.value = value || '';
  promptInput.placeholder = placeholder || '';
  promptHandler = onSave;
  promptModal.classList.add('active');
  setTimeout(() => promptInput.focus(), 0);
}

function closePrompt() {
  if (!promptModal) return;
  promptModal.classList.remove('active');
  promptHandler = null;
}

function openInfo(title, message) {
  if (!infoModal) return;
  infoTitle.textContent = title || 'Info';
  infoMessage.textContent = message || '';
  infoModal.classList.add('active');
}

function closeInfo() {
  if (!infoModal) return;
  infoModal.classList.remove('active');
}

async function fetchCustomers() {
  const response = await fetch('/api/customers');
  if (!response.ok) throw new Error('Failed to load customers.');
  const data = await response.json();
  return data.customers || [];
}

async function createCustomerRecord(payload) {
  const response = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to create customer.');
  }
  return response.json().catch(() => ({}));
}

function openCustomerModal() {
  if (!customerModal) return;
  customerSearch.value = '';
  customerCreateName.value = '';
  customerCreateMemberId.value = '';
  customerCreatePhone.value = '';
  customerCreateEmail.value = '';
  renderCustomerList();
  customerModal.classList.add('active');
  setTimeout(() => customerSearch.focus(), 0);
}

function closeCustomerPicker() {
  if (!customerModal) return;
  customerModal.classList.remove('active');
}

async function renderCustomerList() {
  if (!customerList) return;
  let rows = [];
  try {
    rows = await fetchCustomers();
  } catch (err) {
    customerList.innerHTML = `<div class="orders-empty">${err.message || 'Failed to load customers.'}</div>`;
    return;
  }
  const query = String(customerSearch.value || '').toLowerCase();
  const filtered = rows.filter((row) => {
    if (!query) return true;
    return [row.name, row.phone, row.email].some((value) => String(value || '').toLowerCase().includes(query));
  });
  if (!filtered.length) {
    customerList.innerHTML = `<div class="orders-empty">No customers found.</div>`;
    return;
  }
  customerList.innerHTML = '';
  filtered.forEach((row) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'customer-row';
    el.innerHTML = `
      <div>
        <div>${row.name || '-'}</div>
        <div class="meta">${row.member_id || '-'} ${row.phone ? `• ${row.phone}` : ''} ${row.email ? `• ${row.email}` : ''}</div>
      </div>
      <div>${Number(row.points_balance || 0)} pts</div>
    `;
    el.addEventListener('click', () => {
      customerInput.value = row.name || '';
      if (loyaltyInput) loyaltyInput.value = row.member_id || '';
      state.customerId = row.id || null;
      closeCustomerPicker();
      updatePaymentCustomerLabel();
    });
    customerList.appendChild(el);
  });
}

async function ensureSessionOpening() {
  try {
    const response = await fetch('/api/sessions/open');
    if (!response.ok) return;
    const data = await response.json();
    posSessionId = data.session?.id || null;
    if (!data.opening_required) return;
    openPrompt({
      title: 'Opening Cash',
      label: 'Opening cash amount',
      value: '0',
      placeholder: '0',
      hint: 'Enter the opening cash before selling.',
      onSave: async (value) => {
        const amount = Number(value || 0);
        try {
          const res = await fetch('/api/sessions/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ opening_cash: amount, opened_by: auth?.name || null })
          });
          if (!res.ok) throw new Error('Failed to save opening cash.');
          openInfo('Shift opened', 'Opening cash recorded.');
        } catch (err) {
          openInfo('Opening cash failed', err.message || 'Failed to save opening cash.');
        }
      }
    });
  } catch (err) {
    console.warn('Session open failed', err);
  }
}

function openCashMove(type) {
  if (!posSessionId) {
    openInfo('No session', 'Open a session first.');
    return;
  }
  const title = type === 'in' ? 'Cash In' : 'Cash Out';
  openPrompt({
    title,
    label: 'Amount',
    value: '',
    placeholder: '0',
    hint: 'Enter the cash amount.',
    onSave: (value) => {
      const amount = Number(value || 0);
      if (!(amount > 0)) {
        openInfo('Invalid amount', 'Enter a positive amount.');
        return;
      }
      openPrompt({
        title,
        label: 'Reason',
        value: '',
        placeholder: 'e.g. Change, Petty cash',
        hint: 'Add a short reason for this cash move.',
        onSave: async (reasonValue) => {
          const reason = String(reasonValue || '').trim();
          try {
            const response = await fetch(`/api/sessions/${encodeURIComponent(posSessionId)}/cash-move`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type, amount, reason })
            });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(data.message || 'Cash move failed.');
            }
            openInfo('Saved', `${title} recorded.`);
          } catch (err) {
            openInfo('Cash move failed', err.message || 'Cash move failed.');
          }
        }
      });
    }
  });
}

async function openCloseSessionModal() {
  if (!posSessionId) {
    openInfo('No session', 'Open a session first.');
    return;
  }
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(posSessionId)}/summary`);
    if (!response.ok) throw new Error('Failed to load session summary.');
    const summary = await response.json();
    expectedCash.textContent = formatCurrency(summary.expected?.cash || 0);
    expectedCard.textContent = formatCurrency(summary.expected?.card || 0);
    expectedQris.textContent = formatCurrency(summary.expected?.qris || 0);
    if (expectedBreakdown) {
      const opening = formatCurrency(summary.opening_cash || 0);
      const sales = formatCurrency(summary.payments?.cash || 0);
      const cashIn = formatCurrency(summary.cash_in || 0);
      const cashOut = formatCurrency(summary.cash_out || 0);
      expectedBreakdown.textContent = `${opening} + ${sales} + ${cashIn} - ${cashOut}`;
    }
    countedCash.value = String(summary.expected?.cash || 0);
    countedCard.value = String(summary.expected?.card || 0);
    countedQris.value = String(summary.expected?.qris || 0);
    closeSessionNotes.value = '';
    if (closeSessionSubhead) {
      closeSessionSubhead.textContent = `Shift ${summary.session?.name || ''}`.trim() || 'Review expected vs counted.';
    }
    closeSessionModal.classList.add('active');
  } catch (err) {
    openInfo('Shift summary failed', err.message || 'Failed to load summary.');
  }
}

function requestRefund() {
  openPrompt({
    title: 'Refund Order',
    label: 'Order ID',
    value: '',
    placeholder: 'e.g. 123',
    hint: 'Enter the numeric order ID to refund.',
    onSave: (value) => {
      const orderId = Number(String(value || '').trim());
      if (!Number.isInteger(orderId) || orderId <= 0) {
        openInfo('Invalid Order ID', 'Enter a valid numeric order ID.');
        return;
      }
      openPrompt({
        title: 'Refund Method',
        label: 'Method',
        value: 'cash',
        placeholder: 'cash/card/qris',
        hint: 'Choose how to refund this order.',
        onSave: async (methodValue) => {
          const method = String(methodValue || '').trim() || 'cash';
          try {
            const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ method })
            });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(data.message || 'Refund failed.');
            }
            openInfo('Refunded', `Order ${orderId} refunded.`);
          } catch (err) {
            openInfo('Refund failed', err.message || 'Refund failed.');
          }
        }
      });
    }
  });
}

function renderHeldOrders() {
  renderOrdersView();
}

flowTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    flowTabs.forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    const flow = tab.dataset.flow;
    if (flow === 'tables') {
      navigatePos('/pos/ui/1/tables');
      return;
    }
    if (flow === 'orders') {
      navigatePos('/pos/ui/1/orders');
      return;
    }
    if (flow === 'direct') {
      navigatePos('/pos/ui/1/direct');
      return;
    }
    if (flow === 'register') {
      navigatePos('/pos/ui/1/register');
    }
  });
});

if (posOrdersSearch) {
  posOrdersSearch.addEventListener('input', () => renderOrdersView());
}

if (posOrdersFilter) {
  posOrdersFilter.addEventListener('change', () => renderOrdersView());
}

if (posOrdersTypeChips) {
  posOrdersTypeChips.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (!button) return;
    const value = button.dataset.type || '';
    state.ordersTypeFilter = value;
    posOrdersTypeChips.querySelectorAll('button').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.type === value);
    });
    renderOrdersView();
  });
}


if (promptSave) {
  promptSave.addEventListener('click', () => {
    if (!promptHandler) {
      closePrompt();
      return;
    }
    const handler = promptHandler;
    const value = promptInput.value;
    closePrompt();
    handler(value);
  });
}

if (promptInput) {
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      promptSave?.click();
    }
    if (event.key === 'Escape') {
      closePrompt();
    }
  });
}

if (promptCancel) {
  promptCancel.addEventListener('click', closePrompt);
}

if (promptClose) {
  promptClose.addEventListener('click', closePrompt);
}

promptModal?.addEventListener('click', (event) => {
  if (event.target === promptModal) closePrompt();
});

if (closeCustomerModal) {
  closeCustomerModal.addEventListener('click', closeCustomerPicker);
}

customerModal?.addEventListener('click', (event) => {
  if (event.target === customerModal) closeCustomerPicker();
});

if (customerSearch) {
  customerSearch.addEventListener('input', () => renderCustomerList());
}

if (createCustomer) {
  createCustomer.addEventListener('click', async () => {
    const name = customerCreateName.value.trim();
    if (!name) {
      openInfo('Missing name', 'Enter a customer name.');
      return;
    }
    try {
      const payload = {
        name,
        member_id: customerCreateMemberId.value.trim(),
        phone: customerCreatePhone.value.trim(),
        email: customerCreateEmail.value.trim()
      };
      const result = await createCustomerRecord(payload);
      customerInput.value = result.customer?.name || payload.name;
      if (loyaltyInput) loyaltyInput.value = result.customer?.member_id || payload.member_id || '';
      state.customerId = result.customer?.id || null;
      closeCustomerPicker();
    } catch (err) {
      openInfo('Create failed', err.message || 'Failed to create customer.');
    }
  });
}

if (clearCustomer) {
  clearCustomer.addEventListener('click', () => {
    customerInput.value = '';
    if (loyaltyInput) loyaltyInput.value = '';
    state.customerId = null;
    closeCustomerPicker();
  });
}

if (infoOk) {
  infoOk.addEventListener('click', closeInfo);
}

if (infoClose) {
  infoClose.addEventListener('click', closeInfo);
}

infoModal?.addEventListener('click', (event) => {
  if (event.target === infoModal) closeInfo();
});

if (closeSessionClose) {
  closeSessionClose.addEventListener('click', () => closeSessionModal.classList.remove('active'));
}

if (closeSessionCancel) {
  closeSessionCancel.addEventListener('click', () => closeSessionModal.classList.remove('active'));
}

closeSessionModal?.addEventListener('click', (event) => {
  if (event.target === closeSessionModal) closeSessionModal.classList.remove('active');
});

if (closeSessionConfirm) {
  closeSessionConfirm.addEventListener('click', async () => {
    if (!posSessionId) {
      closeSessionModal.classList.remove('active');
      openInfo('No session', 'Open a session first.');
      return;
    }
    try {
      const payload = {
        counted_cash: Number(countedCash.value || 0),
        counted_card: Number(countedCard.value || 0),
        counted_qris: Number(countedQris.value || 0),
        notes: closeSessionNotes.value.trim(),
        closed_by: auth?.name || null
      };
      const response = await fetch(`/api/sessions/${encodeURIComponent(posSessionId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Close session failed.');
      }
      closeSessionModal.classList.remove('active');
      openInfo('Shift closed', 'Shift closed successfully.');
      posSessionId = null;
      ensureSessionOpening();
    } catch (err) {
      openInfo('Close failed', err.message || 'Close session failed.');
    }
  });
}

if (newOrder) {
  newOrder.addEventListener('click', () => {
    receiptModal?.classList.remove('active');
    if (customerInput) customerInput.value = '';
    if (loyaltyInput) loyaltyInput.value = '';
    state.customerId = null;
    updatePaymentCustomerLabel();
    navigatePos('/pos/ui/1/register', true);
  });
}

receiptModal?.addEventListener('click', (event) => {
  if (event.target === receiptModal) receiptModal.classList.remove('active');
});

if (printReceipt) {
  printReceipt.addEventListener('click', () => {
    window.print();
  });
}

if (sendReceipt) {
  sendReceipt.addEventListener('click', () => {
    const email = receiptEmail?.value.trim();
    if (!email) {
      openInfo('Email required', 'Please enter an email address.');
      return;
    }
    const payload = {
      toEmail: email,
      receipt: {
        ticket: receiptTicket?.textContent || '',
        time: receiptTime?.textContent || '',
        cashier: receiptCashier?.textContent || '',
        orderType: receiptOrderType?.textContent || '',
        subtotal: receiptSubtotal?.textContent || '',
        tax: receiptTax?.textContent || '',
        total: receiptTotal2?.textContent || '',
        footer: receiptFooterText?.textContent || '',
        link: sendReceipt.dataset.link || '',
        qrUrl: sendReceipt.dataset.qr || ''
      }
    };
    fetch('/api/receipt/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to send');
        }
        return res.json().catch(() => ({}));
      })
      .then(() => {
        openInfo('Sent', 'Receipt sent.');
        if (receiptEmail) receiptEmail.value = '';
      })
      .catch((err) => {
        openInfo('Email failed', err.message || 'Failed to send receipt.');
      });
  });
}

if (customerInput) {
  customerInput.addEventListener('input', () => {
    state.customerId = null;
  });
}

if (loyaltyInput) {
  loyaltyInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    const value = loyaltyInput.value.trim();
    if (!value) return;
    try {
      const response = await fetch(`/api/customers?member_id=${encodeURIComponent(value)}`);
      if (!response.ok) throw new Error('Lookup failed.');
      const data = await response.json();
      const row = (data.customers || [])[0];
      if (!row) {
        openInfo('Not found', 'Member ID not found.');
        return;
      }
      customerInput.value = row.name || '';
      state.customerId = row.id || null;
    } catch (err) {
      openInfo('Lookup failed', err.message || 'Failed to lookup member.');
    }
  });
}

if (closeActions) {
  closeActions.addEventListener('click', () => actionsModal.classList.remove('active'));
}

actionsModal?.addEventListener('click', (event) => {
  if (event.target === actionsModal) actionsModal.classList.remove('active');
});

actionsGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'pay') {
    actionsModal.classList.remove('active');
    payModal.classList.add('active');
    return;
  }
  if (action === 'split') {
    actionsModal.classList.remove('active');
    if (splitBtn) splitBtn.click();
    return;
  }
  if (action === 'set_tab') {
    actionsModal.classList.remove('active');
    handleSetTab();
    return;
  }
  if (action === 'set_table') {
    actionsModal.classList.remove('active');
    handleSetTable();
    return;
  }
  if (action === 'update_kitchen') {
    actionsModal.classList.remove('active');
    if (!state.order.length) {
      openInfo('No items', 'No items to send.');
      return;
    }
    const label = state.orderLabel || 'Direct Sale';
    const orderId = state.currentOrderId || crypto.randomUUID();
    sendOrderToKitchen(label, state.order, state.sentToKitchen ? 'update' : 'new', orderId);
    state.currentOrderId = orderId;
    state.sentToKitchen = true;
    openInfo('Sent', 'Kitchen updated.');
    return;
  }
  if (action === 'refund') {
    actionsModal.classList.remove('active');
    requestRefund();
    return;
  }
  if (action === 'cash_in') {
    actionsModal.classList.remove('active');
    openCashMove('in');
    return;
  }
  if (action === 'cash_out') {
    actionsModal.classList.remove('active');
    openCashMove('out');
    return;
  }
  if (action === 'close_session') {
    actionsModal.classList.remove('active');
    openCloseSessionModal();
    return;
  }
  if (action === 'cancel') {
    actionsModal.classList.remove('active');
    if (state.sentToKitchen && state.currentOrderId) {
      sendOrderToKitchen(state.orderLabel || 'Direct Sale', state.order, 'cancel', state.currentOrderId);
    }
    openInfo('Cancelled', 'Order has been cancelled.');
    state.order = [];
    state.selectedLineId = null;
    state.buffer = '';
    state.orderLabel = '';
    state.currentOrderId = null;
    state.sentToKitchen = false;
    state.currentTableId = null;
    state.currentTableName = null;
    setOrderMeta();
    renderOrder();
    return;
  }
  if (action === 'edit_name') {
    actionsModal.classList.remove('active');
    openPrompt({
      title: 'Edit Order Name',
      label: 'Order name',
      value: state.orderLabel || '',
      placeholder: 'e.g. Order 1024',
      onSave: (value) => {
        state.orderLabel = value.trim();
        setOrderMeta();
      }
    });
    return;
  }
  if (action === 'info') {
    actionsModal.classList.remove('active');
    openInfo('Order Info', `Items: ${state.order.length}`);
    return;
  }
  actionsModal.classList.remove('active');
  openInfo('Not ready', 'This action is coming soon.');
});

clearOrder.addEventListener('click', () => {
  resetOrderState();
});

numpad.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  let key = button.dataset.key;
  const action = button.dataset.action;
  if (key) {
    if (key === ',') key = '.';
    if (key === '.' && state.buffer.includes('.')) return;
    state.buffer += key;
    applyBufferToSelected();
    return;
  }
  if (action === 'del') {
    state.buffer = state.buffer.slice(0, -1);
    applyBufferToSelected();
    return;
  }
  if (action === 'qty') {
    state.inputMode = 'qty';
    state.buffer = '';
    return;
  }
  if (action === 'price') {
    state.inputMode = 'price';
    state.buffer = '';
    return;
  }
  if (action === 'disc') {
    state.inputMode = 'disc';
    state.buffer = '';
    return;
  }
  if (action === 'note') {
    openNote();
    return;
  }
  if (action === 'sign') {
    if (!state.buffer) {
      state.buffer = '-';
    } else if (state.buffer.startsWith('-')) {
      state.buffer = state.buffer.slice(1);
    } else {
      state.buffer = `-${state.buffer}`;
    }
    applyBufferToSelected();
  }
});

numpadTop?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  if (!action) return;
  if (action === 'customer') {
    openCustomerModal();
    return;
  }
  if (action === 'note') {
    openNote();
    return;
  }
  if (action === 'dine') {
    setOrderType('dine_in');
    return;
  }
  if (action === 'refund') {
    requestRefund();
    return;
  }
  if (action === 'info') {
    openInfo('Order info', `Items: ${state.order.length} • Total: ${totalEl.textContent || 'Rp 0'}`);
    return;
  }
  if (action === 'enter_code') {
    openInfo('Not ready', 'Enter Code is not available yet.');
    return;
  }
  if (action === 'reset_programs') {
    openInfo('Not ready', 'Reset Programs is not available yet.');
    return;
  }
  if (action === 'reward') {
    openInfo('Not ready', 'Reward is not available yet.');
    return;
  }
  if (action === 'quotation') {
    openInfo('Not ready', 'Quotation/Order is not available yet.');
    return;
  }
  if (action === 'course') {
    const row = state.order.find((item) => item.lineId === state.selectedLineId);
    if (!row) {
      openInfo('No item selected', 'Select an item first.');
      return;
    }
    openPrompt({
      title: 'Course',
      label: 'Course name',
      value: row.course || '',
      placeholder: 'e.g. Starter',
      onSave: (value) => {
        row.course = value.trim();
        renderOrder();
      }
    });
    return;
  }
  if (action === 'more') {
    actionsModal?.classList.add('active');
    return;
  }
});

numpadFooter?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'update_kitchen') {
    if (!state.order.length) {
      openInfo('No items', 'No items to send.');
      return;
    }
    const orderId = state.currentOrderId || crypto.randomUUID();
    const payload = upsertHeldOrder(orderId, { sentToKitchen: true, status: 'ongoing' });
    sendOrderToKitchen(payload.label || 'Direct Sale', state.order, state.sentToKitchen ? 'update' : 'new', orderId);
    state.currentOrderId = orderId;
    state.sentToKitchen = true;
    openInfo('Sent', 'Kitchen updated.');
    renderOrder();
    return;
  }
  if (action === 'new_order') {
    resetOrderState();
    return;
  }
  if (action === 'payment') {
    openPayModal();
    return;
  }
  if (action === 'set_table') {
    handleSetTable();
    return;
  }
  if (action === 'set_tab') {
    handleSetTab();
  }
});

payNow.addEventListener('click', () => {
  openPayModal();
});

if (payTile) {
  payTile.addEventListener('click', () => {
    openPayModal();
  });
}

closePay.addEventListener('click', () => {
  payModal.classList.remove('active');
});

if (paymentType) {
  paymentType.addEventListener('change', updateChangeDisplay);
}

if (tenderedInput) {
  tenderedInput.addEventListener('input', updateChangeDisplay);
}

if (paymentCustomerBtn) {
  paymentCustomerBtn.addEventListener('click', () => {
    openCustomerModal();
  });
}

confirmPay.addEventListener('click', async () => {
  if (!state.order.length) {
    openInfo('No items', 'Please add items before payment.');
    return;
  }
  if (!activeEmployee) {
    openInfo('Not ready', 'No active cashier yet — try again in a moment.');
    return;
  }

  const totals = calculateTotals();
  const method = paymentType?.value || 'cash';
  const wantsInvoice = Boolean(invoiceCheck?.checked);
  const tendered = parseAmount(tenderedInput?.value);
  const change = Math.max(0, tendered - totals.total);
  if (method === 'cash' && tendered < totals.total) {
    openInfo('Insufficient cash', 'Tendered amount is less than total.');
    return;
  }
  // thumbaz's /api/sales has no per-line discount concept, only a flat
  // (currently display-only) discount_amount — so fold each line's % discount
  // into the price/modifier deltas sent, keeping the recorded sale equal to
  // what's shown in the Total here rather than silently losing the discount.
  const payload = {
    items: state.order.map((item) => {
      const discountFrac = Math.max(0, Math.min(1, Number(item.discount || 0) / 100));
      const price = Math.round(item.price * (1 - discountFrac));
      const modifiers = (item.modifiers || []).map((mod) => ({
        id: mod.modifier_id || undefined,
        custom_name: mod.modifier_id ? undefined : mod.name,
        price_delta: Math.round(Number(mod.price || 0) * (1 - discountFrac))
      }));
      return {
        product_id: item.id,
        name: item.name,
        price,
        quantity: item.qty,
        custom_name: item.isCustom ? item.name : null,
        modifiers
      };
    }),
    payment_type: method,
    order_type: getOrderTypeValue(),
    amount_tendered: method === 'cash' ? tendered : null
  };

  let saleId = null;
  try {
    const response = await fetch('/api/sales', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save order.');
    }
    saleId = data.sale_id;
    if (saleId) localStorage.setItem(LAST_SALE_KEY, String(saleId));
  } catch (err) {
    openInfo('Payment failed', err.message || 'Failed to save order.');
    return;
  }

  const isInvoice = Boolean(wantsInvoice);
  const ticket = isInvoice
    ? `INV-${String(saleId).padStart(6, '0')}`
    : `RCPT-${String(saleId).padStart(6, '0')}`;
  const time = new Date().toLocaleString('id-ID');
  // Scannable receipt code — plain-text summary (ticket/total/date), not a
  // link, since there's no digital receipt page to link to yet.
  const receiptLink = `${ticket}\n${formatCurrency(totals.total)}\n${time}`;
  const qrImageUrl = `/api/qr?text=${encodeURIComponent(receiptLink)}&format=png&ts=${Date.now()}`;
  if (receiptItems) {
    receiptItems.innerHTML = state.order.map((item) => {
      const mods = item.modifiers?.map((mod) => ` + ${mod.name}`).join('') || '';
      const note = item.note ? `<div class="receipt-note">Note: ${item.note}</div>` : '';
      return `
        <div class="receipt-item">
          <div>${item.qty}x</div>
          <div>
            <div class="name">${item.name}${mods}</div>
            <div class="sub">${formatCurrency(item.price)} / unit</div>
            ${note}
          </div>
          <div>${formatCurrency(item.price * item.qty)}</div>
        </div>
      `;
    }).join('');
  }
  if (receiptTotal) receiptTotal.textContent = formatCurrency(totals.total);
  if (receiptTotal2) receiptTotal2.textContent = formatCurrency(totals.total);
  if (receiptSubtotal) receiptSubtotal.textContent = formatCurrency(totals.subtotal);
  if (receiptTax) receiptTax.textContent = formatCurrency(totals.tax);
  if (receiptChange && receiptChangeLine) {
    if (method === 'cash') {
      receiptChange.textContent = formatCurrency(change);
      receiptChangeLine.style.display = '';
    } else {
      receiptChangeLine.style.display = 'none';
    }
  }
  if (receiptTitle) {
    receiptTitle.textContent = isInvoice ? 'Invoice' : 'Receipt';
  }
  if (receiptTicket) {
    receiptTicket.textContent = `${isInvoice ? 'Invoice' : 'Receipt'} ${ticket}`;
  }
  if (receiptOrderType) {
    receiptOrderType.textContent = `Order Type: ${formatOrderType(getOrderTypeValue())}`;
  }
  if (receiptCustomer) {
    const customerName = customerInput?.value.trim();
    if (wantsInvoice && customerName) {
      receiptCustomer.textContent = `Customer: ${customerName}`;
      receiptCustomer.classList.remove('hidden');
    } else {
      receiptCustomer.classList.add('hidden');
    }
  }
  if (receiptTime) receiptTime.textContent = time;
  if (receiptCashier) receiptCashier.textContent = `Served by: ${auth?.name || 'Cashier'}`;
  if (receiptFooterText) receiptFooterText.textContent = settings.receiptFooter || 'Thank you!';
  if (receiptLogoImg && receiptLogoText) {
    if (settings.logoUrl) {
      receiptLogoImg.src = settings.logoUrl;
      receiptLogoImg.parentElement?.classList.add('has-image');
      receiptLogoText.textContent = settings.storeName || '8 NewLight';
    } else {
      receiptLogoImg.parentElement?.classList.remove('has-image');
      receiptLogoText.textContent = settings.storeName || '8 NewLight';
    }
  }
  if (receiptQr) {
    receiptQr.src = qrImageUrl;
    fetch(`/api/qr?text=${encodeURIComponent(receiptLink)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('QR service unavailable');
        const data = await res.json();
        if (!data.dataUrl) throw new Error('QR failed');
        if (sendReceipt) sendReceipt.dataset.qr = data.dataUrl;
      })
      .catch(() => {
        if (sendReceipt) sendReceipt.dataset.qr = qrImageUrl;
      });
  }
  if (sendReceipt) {
    sendReceipt.dataset.link = receiptLink;
  }

  payModal.classList.remove('active');
  receiptModal?.classList.add('active');
  if (tenderedInput) tenderedInput.value = '';
  if (state.currentTableId) {
    try {
      const tables = typeof loadTables === 'function' ? loadTables() : [];
      const table = tables.find((t) => t.id === state.currentTableId);
      if (table) {
        table.status = 'paid';
        table.paid = true;
        if (typeof saveTables === 'function') saveTables(tables);
      }
    } catch (err) {}
  }
  if (state.currentOrderId) {
    upsertHeldOrder(state.currentOrderId, {
      status: wantsInvoice ? 'invoice' : 'paid',
      receiptNumber: ticket,
      isInvoice,
      customerName: customerInput?.value.trim() || null,
      orderType: getOrderTypeValue(),
      total: totals.total,
      items: state.order
    });
  }
  state.order = [];
  state.selectedLineId = null;
  state.buffer = '';
  state.orderLabel = '';
  state.currentOrderId = null;
  state.sentToKitchen = false;
  state.currentTableId = null;
  state.currentTableName = null;
  setOrderMeta();
  renderOrder();
});

payModal.addEventListener('click', (event) => {
  if (event.target === payModal) {
    payModal.classList.remove('active');
  }
});

// Real modifiers (e.g. "Extra Shot") come from thumbaz's /api/modifiers table
// (the original prototype used a hardcoded local list). Fetched once, cached.
let modifiersListCache = null;
async function fetchModifiersList() {
  if (modifiersListCache) return modifiersListCache;
  try {
    const res = await fetch('/api/modifiers', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    modifiersListCache = res.ok ? await res.json() : [];
  } catch (err) {
    modifiersListCache = [];
  }
  return modifiersListCache;
}

async function openModifierModal(item) {
  if (!modifierModal) return;
  modifierItem.textContent = item ? `Item: ${item.name}` : 'Select an item';
  modifierList.innerHTML = '<div class="muted">Loading…</div>';
  modifierModal.classList.add('active');
  const modifierOptions = await fetchModifiersList();
  modifierList.innerHTML = '';
  if (!modifierOptions.length) {
    modifierList.innerHTML = '<div class="muted">No modifiers yet — add one below or in Manage Modifiers.</div>';
  }
  modifierOptions.forEach((mod) => {
    const btn = document.createElement('button');
    btn.className = 'modifier-btn';
    btn.textContent = `${mod.name} (+${formatCurrency(mod.price_delta)})`;
    btn.addEventListener('click', () => {
      item.modifiers.push({ name: mod.name, price: mod.price_delta, modifier_id: mod.id });
      renderOrder();
    });
    modifierList.appendChild(btn);
  });
}

if (closeModifier) {
  closeModifier.addEventListener('click', () => modifierModal.classList.remove('active'));
}

// Manage Modifiers — add/edit/disable the modifiers offered in the picker
// above, ported from pos.html's Manage Modifiers drawer.
async function refreshModifiers() {
  modifiersListCache = null;
  return fetchModifiersList();
}

function renderManageModifierList(modifiers) {
  if (!manageModifierList) return;
  manageModifierList.innerHTML = '';
  if (!modifiers.length) {
    manageModifierList.innerHTML = '<div class="muted">No modifiers yet.</div>';
    return;
  }
  modifiers.forEach((mod) => {
    const row = document.createElement('div');
    row.className = 'manage-modifier-row';
    row.innerHTML = `
      <div>
        <label>Name</label>
        <input type="text" data-field="name" value="${String(mod.name || '').replace(/"/g, '&quot;')}" />
      </div>
      <div>
        <label>Price</label>
        <input type="number" step="1" data-field="price" value="${Number(mod.price_delta || 0)}" />
      </div>
      <button class="pay" data-action="save" data-id="${mod.id}">Save</button>
      <button class="pay" data-action="delete" data-id="${mod.id}">Disable</button>
    `;
    manageModifierList.appendChild(row);
  });
}

async function openManageModifiers() {
  if (!manageModifiersModal) return;
  manageModifiersModal.classList.add('active');
  manageModifierList.innerHTML = '<div class="muted">Loading…</div>';
  const modifiers = await refreshModifiers();
  renderManageModifierList(modifiers);
}

if (manageModifiersBtn) {
  const canManage = auth && ['admin', 'manager'].includes(auth.role);
  if (!canManage) {
    manageModifiersBtn.style.display = 'none';
  } else {
    manageModifiersBtn.addEventListener('click', openManageModifiers);
  }
}

if (closeManageModifiers) {
  closeManageModifiers.addEventListener('click', () => manageModifiersModal.classList.remove('active'));
}

manageModifiersModal?.addEventListener('click', (event) => {
  if (event.target === manageModifiersModal) manageModifiersModal.classList.remove('active');
});

if (createModifierBtn) {
  createModifierBtn.addEventListener('click', async () => {
    const name = newModifierName ? newModifierName.value.trim() : '';
    const price = newModifierPrice ? Number(newModifierPrice.value || 0) : NaN;
    if (!name || !Number.isFinite(price)) {
      openInfo('Missing info', 'Modifier name and price are required.');
      return;
    }
    try {
      const res = await fetch('/api/modifiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
        body: JSON.stringify({ name, price_delta: price })
      });
      if (!res.ok) throw new Error('Failed to add modifier.');
      newModifierName.value = '';
      newModifierPrice.value = '';
      renderManageModifierList(await refreshModifiers());
    } catch (err) {
      openInfo('Failed', err.message || 'Failed to add modifier.');
    }
  });
}

if (manageModifierList) {
  manageModifierList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = Number(button.dataset.id);
    if (!id) return;
    const row = button.closest('.manage-modifier-row');
    const nameInput = row ? row.querySelector('input[data-field="name"]') : null;
    const priceInput = row ? row.querySelector('input[data-field="price"]') : null;
    if (action === 'save') {
      const name = nameInput ? nameInput.value.trim() : '';
      const price = priceInput ? Number(priceInput.value || 0) : NaN;
      if (!name || !Number.isFinite(price)) {
        openInfo('Missing info', 'Name and price are required.');
        return;
      }
      try {
        const res = await fetch(`/api/modifiers/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
          body: JSON.stringify({ name, price_delta: price })
        });
        if (!res.ok) throw new Error('Failed to update modifier.');
        renderManageModifierList(await refreshModifiers());
      } catch (err) {
        openInfo('Failed', err.message || 'Failed to update modifier.');
      }
    } else if (action === 'delete') {
      if (!confirm('Disable this modifier?')) return;
      try {
        const res = await fetch(`/api/modifiers/${id}`, {
          method: 'DELETE',
          headers: typeof authHeaders === 'function' ? authHeaders() : {}
        });
        if (!res.ok) throw new Error('Failed to disable modifier.');
        renderManageModifierList(await refreshModifiers());
      } catch (err) {
        openInfo('Failed', err.message || 'Failed to disable modifier.');
      }
    }
  });
}

if (addCustomMod) {
  addCustomMod.addEventListener('click', () => {
    const item = state.order.find((row) => row.lineId === state.selectedLineId);
    if (!item) return;
    const name = customModName.value.trim();
    const price = Number(customModPrice.value || 0);
    if (!name) return;
    item.modifiers.push({ name, price: Number.isFinite(price) ? price : 0 });
    customModName.value = '';
    customModPrice.value = '';
    renderOrder();
  });
}

modifierModal?.addEventListener('click', (event) => {
  if (event.target === modifierModal) modifierModal.classList.remove('active');
});

function renderSplitBills() {
  if (!billA || !billB) return;
  billA.innerHTML = '';
  billB.innerHTML = '';
  const billBSet = new Set(state.splitLines || []);
  let totalA = 0;
  let totalB = 0;
  state.order.forEach((item) => {
    const mods = item.modifiers.reduce((sum, mod) => sum + Number(mod.price || 0), 0);
    const lineTotal = (item.price + mods) * item.qty * (1 - item.discount / 100);
    const target = billBSet.has(item.lineId) ? billB : billA;
    const row = document.createElement('div');
    row.className = 'split-item';
    row.innerHTML = `
      <span>${item.name} × ${item.qty}</span>
      <button class="qty-btn">${billBSet.has(item.lineId) ? '←' : '→'}</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      if (billBSet.has(item.lineId)) {
        billBSet.delete(item.lineId);
      } else {
        billBSet.add(item.lineId);
      }
      state.splitLines = Array.from(billBSet);
      renderSplitBills();
    });
    target.appendChild(row);
    if (billBSet.has(item.lineId)) {
      totalB += lineTotal;
    } else {
      totalA += lineTotal;
    }
  });
  billATotal.textContent = formatCurrency(totalA);
  billBTotal.textContent = formatCurrency(totalB);
}

if (splitBtn) {
  splitBtn.addEventListener('click', () => {
    state.splitLines = state.splitLines || [];
    renderSplitBills();
    splitModal.classList.add('active');
  });
}

if (closeSplit) {
  closeSplit.addEventListener('click', () => splitModal.classList.remove('active'));
}

splitModal?.addEventListener('click', (event) => {
  if (event.target === splitModal) splitModal.classList.remove('active');
});

if (loyaltyBtn) {
  loyaltyBtn.addEventListener('click', () => {
    openInfo('Coming soon', 'Loyalty accounts aren\'t wired up in this concept yet.');
  });
}

// Hold — parks the current order (via the same upsertHeldOrder/localStorage
// mechanism "Send to Bar" already used) and clears the register so the
// cashier can start the next order. This is what makes the Orders tab have
// anything to show/load — it was a dead button in the original prototype.
const holdBtn = document.getElementById('holdBtn');
const invoiceBtn = document.getElementById('invoiceBtn');
const refundBtn = document.getElementById('refundBtn');
if (holdBtn) {
  holdBtn.addEventListener('click', () => {
    if (!state.order.length) {
      openInfo('No items', 'Add items before putting an order on hold.');
      return;
    }
    const orderId = state.currentOrderId || crypto.randomUUID();
    upsertHeldOrder(orderId, { status: 'draft' });
    resetOrderState();
    updateOrdersBadge();
    openInfo('Held', 'Order parked — find it under the Orders tab.');
  });
}
if (invoiceBtn) {
  invoiceBtn.addEventListener('click', () => {
    openInfo('Coming soon', 'Invoices aren\'t wired up in this concept yet.');
  });
}

// Void Last Sale — ported from pos.html's voidSale(). Reverses the most
// recent sale (restores deducted inventory, deletes the transaction) via the
// same /api/sales/:id/void endpoint. thumbaz doesn't accept an arbitrary
// past order for refund, only "undo the last one", same as pos.html today.
function voidLastSale() {
  const lastSaleId = localStorage.getItem(LAST_SALE_KEY);
  if (!lastSaleId) {
    openInfo('Nothing to void', 'Complete a sale first.');
    return;
  }
  openPrompt({
    title: 'Void Last Sale',
    label: 'Manager PIN',
    value: '',
    placeholder: 'PIN',
    hint: 'Required to void a sale.',
    onSave: (pin) => {
      if (!pin) {
        openInfo('PIN required', 'Enter the manager PIN to void.');
        return;
      }
      openPrompt({
        title: 'Void Reason',
        label: 'Reason',
        value: '',
        placeholder: 'e.g. Wrong item, customer changed mind',
        hint: 'Add a short reason for this void.',
        onSave: async (reason) => {
          try {
            const res = await fetch(`/api/sales/${encodeURIComponent(lastSaleId)}/void`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ manager_pin: pin, reason: reason || '' })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Void failed.');
            localStorage.removeItem(LAST_SALE_KEY);
            openInfo('Voided', data.message || 'Sale voided.');
          } catch (err) {
            openInfo('Void failed', err.message || 'Void failed.');
          }
        }
      });
    }
  });
}

if (refundBtn) {
  refundBtn.addEventListener('click', voidLastSale);
}

// Price Check — tap a product to see its price without adding it to the
// order, ported from pos.html's shortcutPrice.
if (priceCheckBtn) {
  priceCheckBtn.addEventListener('click', () => {
    priceCheckMode = true;
    openInfo('Price check', 'Tap a product to see its price.');
  });
}

// Add Custom Item — a one-off line not tied to a real menu product, ported
// from pos.html's addCustomItem(). Price starts at 0; select it and use the
// numpad's "Price" key to set it, same flow as any other line.
if (addCustomItemBtn) {
  addCustomItemBtn.addEventListener('click', () => {
    if (!customProductId) {
      openInfo('Not configured', 'No "Custom Item" product found in the menu.');
      return;
    }
    const customCount = state.order.filter((row) => row.isCustom).length + 1;
    const nameInput = window.prompt('Custom item name', `Custom Item ${customCount}`);
    if (nameInput === null) return; // cancelled
    const name = nameInput.trim() || `Custom Item ${customCount}`;
    const priceInput = window.prompt(`Price for "${name}" (Rp)`, '0');
    if (priceInput === null) return; // cancelled
    const price = Math.max(0, Math.round(Number(String(priceInput).replace(/[^0-9.]/g, '')) || 0));
    const line = {
      lineId: crypto.randomUUID(),
      id: customProductId,
      name,
      price,
      qty: 1,
      note: '',
      discount: 0,
      modifiers: [],
      isCustom: true
    };
    state.order.push(line);
    state.selectedLineId = line.lineId;
    state.inputMode = 'qty';
    state.buffer = '';
    renderOrder();
  });
}

// Phone-width bottom sheet — collapsed by default (see .mobile-cart-toggle
// in pos-new.css), tap to expand the full cart/numpad/payment panel.
if (mobileCartToggle && orderPanelEl) {
  mobileCartToggle.addEventListener('click', () => {
    orderPanelEl.classList.toggle('expanded');
  });
}

setClock();
setInterval(setClock, 1000 * 30);
if (orderTypeSelect) {
  orderTypeSelect.value = settings.orderType || 'dine_in';
  orderTypeSelect.addEventListener('change', () => {
    setOrderType(orderTypeSelect.value);
  });
  setOrderType(orderTypeSelect.value);
}
function loadTransferOrder() {
  try {
    const raw = localStorage.getItem('pos_transfer_order');
    if (!raw) return false;
    const payload = JSON.parse(raw);
    localStorage.removeItem('pos_transfer_order');
    if (!payload || !Array.isArray(payload.items) || !payload.items.length) return false;
    try {
      const currentRaw = localStorage.getItem(CURRENT_ORDER_KEY);
      if (currentRaw) {
        const current = JSON.parse(currentRaw);
        if (current?.items?.length) {
          const held = loadHeldOrders();
          const total = current.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
          held.push({
            id: crypto.randomUUID(),
            label: current.label || `Tab ${held.length + 1}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            total,
            items: current.items,
            sentToKitchen: current.sentToKitchen,
            orderType: current.orderType || settings.orderType || 'dine_in'
          });
          saveHeldOrders(held);
          updateOrdersBadge();
        }
        localStorage.removeItem(CURRENT_ORDER_KEY);
      }
    } catch (err) {}
    state.order = payload.items.map((item) => ({
      lineId: crypto.randomUUID(),
      id: item.id,
      name: item.name,
      price: item.price,
      qty: item.qty,
      note: item.note || '',
      discount: Number(item.discount || 0),
      modifiers: item.modifiers || []
    }));
    state.selectedLineId = state.order[0]?.lineId || null;
    state.orderLabel = payload.label || '';
    if (orderTypeSelect) {
      orderTypeSelect.value = payload.orderType || settings.orderType || 'dine_in';
      orderTypeSelect.dispatchEvent(new Event('change'));
    }
    setOrderMeta();
    renderOrder();
    return true;
  } catch (err) {
    return false;
  }
}

showRegisterView();
setOrderMeta();
initProducts();
loadActiveEmployee();
loadTransferOrder();
renderOrder();
ensureSessionOpening();
updateOrdersBadge();
handlePosRoute();

window.addEventListener('popstate', () => handlePosRoute());

try {
  const openOrdersFlag = localStorage.getItem('pos_open_orders_modal');
  if (openOrdersFlag) {
    localStorage.removeItem('pos_open_orders_modal');
    navigatePos('/pos/ui/1/orders', true);
  }
} catch (err) {}
