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
let customProductId = null;
const LAST_SALE_KEY = 'pos_new_last_sale_id';
const LAST_SALE_SUMMARY_KEY = 'pos_new_last_sale';

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
  customer: null,
  redeemPoints: 0,
  redeemValue: 0,
  orderDiscount: 0,
  ordersViewSelectedId: null,
  ordersTypeFilter: ''
};
// Loyalty program rules — fetched from the server (loyalty_config, editable via
// the Loyalty Setup screen). These are only for previews; the server recomputes
// authoritatively at checkout. Seeded with the historical defaults so the UI is
// sane before the fetch resolves.
let loyaltyConfig = { earn_base: 10000, earn_points: 1, redeem_rate: 100, enabled: 1 };
async function loadLoyaltyConfig() {
  try {
    const res = await fetch('/api/loyalty-config', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.config) loyaltyConfig = data.config;
    }
  } catch (_) { /* keep defaults on failure */ }
}
// Order types — data-driven (order_types table, editable on the Order Types
// page). Delivery platforms (Grab Food / Go Food) carry a per-item charge the
// POS applies as a discount on the order total, matching how the source POS
// records Grab/Go orders. Seeded so the picker works before the fetch resolves.
let orderTypesConfig = [
  { name: 'Dine In', per_item_discount: 0 },
  { name: 'Takeaway', per_item_discount: 0 },
  { name: 'Delivery', per_item_discount: 0 }
];
// Map legacy stored keys (old snake-case values) onto the current display names.
const LEGACY_ORDER_TYPE = { dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery' };
function normalizeOrderType(v) {
  const s = String(v || '').trim();
  return LEGACY_ORDER_TYPE[s] || s || 'Dine In';
}
// Per-item charge (Rp) for the currently selected order type, 0 if none.
function deliveryPerItem() {
  const name = normalizeOrderType(getOrderTypeValue());
  const cfg = orderTypesConfig.find((t) => t.name === name);
  return cfg ? Number(cfg.per_item_discount || 0) : 0;
}
async function loadOrderTypes() {
  try {
    const res = await fetch('/api/order-types', { credentials: 'same-origin', headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.orderTypes) || !data.orderTypes.length) return;
    orderTypesConfig = data.orderTypes.map((t) => ({ name: t.name, per_item_discount: Number(t.per_item_discount || 0) }));
    if (orderTypeSelect) {
      const current = normalizeOrderType(orderTypeSelect.value);
      orderTypeSelect.innerHTML = orderTypesConfig
        .map((t) => `<option value="${t.name}">${t.name}</option>`).join('');
      orderTypeSelect.value = orderTypesConfig.some((t) => t.name === current) ? current : orderTypesConfig[0].name;
    }
    if (typeof updateTotals === 'function') updateTotals();
  } catch (_) { /* keep seeded defaults on failure */ }
}

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
const redeemedRow = document.getElementById('redeemedRow');
const redeemedValueEl = document.getElementById('redeemedValue');
const totalEl = document.getElementById('total');
const searchInput = document.getElementById('searchInput');
const clearOrder = document.getElementById('clearOrder');
const numpad = document.getElementById('numpad');
const numpadMain = document.querySelector('.numpad-main');
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
const transactionNote = document.getElementById('transactionNote');
const paymentCustomerBtn = document.getElementById('paymentCustomerBtn');
const paymentCustomerName = document.getElementById('paymentCustomerName');
const invoiceCheck = document.getElementById('invoiceCheck');
const clock = document.getElementById('clock');
const orderTypeSelect = document.getElementById('orderType');
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
const receiptNote = document.getElementById('receiptNote');
const receiptLoyalty = document.getElementById('receiptLoyalty');
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
const loyaltyModal = document.getElementById('loyaltyModal');
const loyaltyBody = document.getElementById('loyaltyBody');
const closeLoyalty = document.getElementById('closeLoyalty');
const customerModal = document.getElementById('customerModal');
const closeCustomerModal = document.getElementById('closeCustomerModal');
const customerSearch = document.getElementById('customerSearch');
const customerList = document.getElementById('customerList');
const customerCreateName = document.getElementById('customerCreateName');
const customerCreatePhone = document.getElementById('customerCreatePhone');
const customerCreateEmail = document.getElementById('customerCreateEmail');
const createCustomer = document.getElementById('createCustomer');
const clearCustomer = document.getElementById('clearCustomer');
const addCustomItemBtn = document.getElementById('addCustomItemBtn');
const manageModifiersBtn = document.getElementById('manageModifiersBtn');
const manageModifiersModal = document.getElementById('manageModifiersModal');
const closeManageModifiers = document.getElementById('closeManageModifiers');
const manageModifierList = document.getElementById('manageModifierList');
const newModifierName = document.getElementById('newModifierName');
const newModifierPrice = document.getElementById('newModifierPrice');
const newModifierProduct = document.getElementById('newModifierProduct');
const newModifierMargin = document.getElementById('newModifierMargin');
const createModifierBtn = document.getElementById('createModifierBtn');

// Build <option> tags for the "deducts recipe of" product picker from the
// already-loaded `products`. Empty value = price-only modifier (no deduction).
function productOptionsHtml(selectedId) {
  const opts = ['<option value="">None (price only)</option>'];
  (products || []).slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach((p) => {
      const sel = Number(selectedId) === Number(p.id) ? ' selected' : '';
      const nm = String(p.name || '').replace(/</g, '&lt;');
      opts.push(`<option value="${p.id}"${sel}>${nm}</option>`);
    });
  return opts.join('');
}

// A "cost Rp… · margin Rp… (NN%)" hint for a price + linked product, using the
// product's recipe COGS (std_cost_per_item). Empty when nothing is linked.
function modifierMarginHint(priceDelta, productId) {
  const prod = (products || []).find((p) => Number(p.id) === Number(productId));
  if (!prod) return '';
  const cost = Math.round(Number(prod.std_cost_per_item || 0));
  const price = Math.round(Number(priceDelta || 0));
  const margin = price - cost;
  const pct = price > 0 ? Math.round((margin / price) * 100) : 0;
  return `Deducts ${prod.name} · cost ${formatCurrency(cost)} · margin ${formatCurrency(margin)} (${pct}%)`;
}
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
    orderTypeSelect.value = normalizeOrderType(order.orderType || order.order_type || settings.orderType);
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
      if (typeFilter && normalizeOrderType(order.orderType) !== typeFilter) return false;
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
  return normalizeOrderType(orderTypeSelect?.value || settings.orderType);
}

function formatOrderType(value) {
  // Names are already display-ready; just fold any legacy snake-case keys.
  return normalizeOrderType(value);
}

function setOrderType(value) {
  const name = normalizeOrderType(value);
  if (orderTypeSelect) {
    orderTypeSelect.value = orderTypesConfig.some((t) => t.name === name) ? name : (orderTypesConfig[0]?.name || name);
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
  // No "All" chip — categories are the real product categories only.
  const rawCategories = Array.from(new Set(products.map((item) => item.category))).filter(Boolean);
  // Order chips by total quantity sold (most-sold first); categories with no
  // sales fall to the end, alphabetical among themselves. Falls back to plain
  // alphabetical order if the sales endpoint is unavailable.
  let salesRank = {};
  try {
    const res = await fetch('/api/pos-category-sales', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    if (res.ok) {
      (await res.json()).forEach((row) => { salesRank[row.category] = Number(row.qty) || 0; });
    }
  } catch (err) { /* keep default order on failure */ }
  categories = rawCategories.sort((a, b) => {
    const diff = (salesRank[b] || 0) - (salesRank[a] || 0);
    return diff !== 0 ? diff : String(a).localeCompare(String(b));
  });
  // Default the active filter to the first (most-sold) category.
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
      ${item.modifiers.map((mod) => `<div class=\"order-item-note\">• ${mod.name} (${formatCurrency(mod.price)})</div>`).join('')}
      ${(item.extra_ingredients || []).map((ing) => `<div class=\"order-item-note\">▪ ${ing.name || 'ingredient'} ${ing.qty_base}${ing.base_unit || ''}</div>`).join('')}
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
  // The line-edit keypad no longer lives in the order panel — quantity is on the
  // line stepper, and the keypad now appears at Payment for tendering cash.
  numpadMain?.classList.add('hidden');
  numpadFooter?.classList.toggle('hidden', !hasItems);
  // Pre-transaction chips (Customer / Set Table / Void) are hidden — an empty
  // cart has nothing to act on. Customer & Void live in the has-items row.
  numpadPreActions?.classList.add('hidden');
  numpadPostActions?.classList.toggle('hidden', !hasItems);
  // The action card (Split Bill/Invoice/Void Sale) stays permanently hidden —
  // those actions live only in the footer "⋯" extension sheet, not as buttons
  // docked around the numpad.
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
  // Whole-order discount % applied at Payment, on top of any per-line discount.
  const orderDiscountPct = Math.max(0, Math.min(100, Number(state.orderDiscount || 0)));
  const afterLineDiscount = Math.max(0, subtotal - discount);
  const orderDiscountAmt = Math.round(afterLineDiscount * orderDiscountPct / 100);
  // Delivery-platform charge (Grab Food / Go Food): a flat rupiah amount per
  // item that the platform takes, applied here as a discount so the recorded
  // total is the shop's net take — same shape the Grab source data uses.
  // Capped per line at that line's post-%-discount base value (never negative).
  const perItem = deliveryPerItem();
  const deliveryDiscount = perItem > 0 ? Math.round(state.order.reduce((sum, item) => {
    const frac = Math.max(0, Math.min(1, Number(item.discount || 0) / 100));
    return sum + Math.min(item.price * (1 - frac), perItem) * item.qty;
  }, 0)) : 0;
  const totalDiscount = discount + orderDiscountAmt + deliveryDiscount;
  const taxRate = Number(settings.taxRate || 0);
  const taxable = Math.max(0, subtotal - totalDiscount);
  const tax = taxable * (taxRate / 100);
  const gross = taxable + tax;
  // Loyalty redemption applied to the whole order, capped at the bill.
  const redeemValue = Math.min(Number(state.redeemValue || 0), gross);
  const total = gross - redeemValue;
  return { subtotal, discount: totalDiscount, orderDiscountPct, orderDiscountAmt, deliveryDiscount, perItem, tax, redeemValue, total };
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
  const { subtotal, discount, deliveryDiscount, tax, redeemValue, total } = totals;
  subtotalEl.textContent = formatCurrency(subtotal);
  // Discount line shows manual/line discounts; the delivery-platform charge gets
  // its own labelled row so it's clear where it comes from (both are in `total`).
  discountEl.textContent = formatCurrency(Math.max(0, discount - (deliveryDiscount || 0)));
  const deliveryRow = document.getElementById('deliveryChargeRow');
  if (deliveryRow) {
    if (deliveryDiscount > 0) {
      const lbl = document.getElementById('deliveryChargeLabel');
      if (lbl) lbl.textContent = `${normalizeOrderType(getOrderTypeValue())} charge`;
      document.getElementById('deliveryCharge').textContent = `- ${formatCurrency(deliveryDiscount)}`;
      deliveryRow.style.display = '';
    } else {
      deliveryRow.style.display = 'none';
    }
  }
  if (taxEl) taxEl.textContent = formatCurrency(tax);
  if (redeemedRow && redeemedValueEl) {
    if (redeemValue > 0) {
      redeemedValueEl.textContent = `- ${formatCurrency(redeemValue)}`;
      redeemedRow.style.display = '';
    } else {
      redeemedRow.style.display = 'none';
    }
  }
  totalEl.textContent = formatCurrency(total);
  modalTotal.textContent = formatCurrency(total);
  if (loyaltyPointsEl) {
    const base = Number(loyaltyConfig.earn_base || 0);
    const rate = Number(loyaltyConfig.earn_points || 0);
    const points = (loyaltyConfig.enabled && base > 0) ? Math.floor(total / base) * rate : 0;
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
  // Without this, the next order silently inherits the previous customer's
  // loyalty link — their points would be awarded to whoever ordered next.
  state.customerId = null;
  state.customer = null;
  state.redeemPoints = 0;
  state.redeemValue = 0;
  state.orderDiscount = 0;
  if (customerInput) customerInput.value = '';
  if (loyaltyInput) loyaltyInput.value = '';
  updatePaymentCustomerLabel();
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

// Payment keypad mode: 'tender' types the cash tendered, 'discount' types a
// whole-order discount % (like the old numpad's % key).
let payMode = 'tender';

function openPayModal() {
  payModal.classList.add('active');
  if (invoiceCheck) invoiceCheck.checked = false;
  if (tenderedInput) tenderedInput.value = '';
  updatePayKeypadVisibility();
  renderDiscountView();
  updateChangeDisplay();
  updatePaymentCustomerLabel();
  refreshPaymentLoyalty();
}

function setPayMode(mode) {
  payMode = mode;
  document.querySelectorAll('#payKeypad .mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}

// Quick-cash chips + tendered field only make sense for cash. The keypad itself
// stays visible for every method because the discount % applies regardless; for
// non-cash we hide the Tender mode and force discount entry.
function updatePayKeypadVisibility() {
  const isCash = (paymentType?.value || 'cash') === 'cash';
  document.getElementById('payQuickCash')?.classList.toggle('hidden', !isCash);
  document.getElementById('tenderRow')?.classList.toggle('hidden', !isCash);
  const tenderMode = document.querySelector('#payKeypad .mode[data-mode="tender"]');
  if (tenderMode) tenderMode.style.visibility = isCash ? '' : 'hidden';
  setPayMode(isCash ? 'tender' : 'discount');
}

function renderDiscountView() {
  const totals = calculateTotals();
  const pctEl = document.getElementById('payDiscountPct');
  const amtEl = document.getElementById('payDiscountAmt');
  if (pctEl) pctEl.textContent = String(Math.round(totals.orderDiscountPct || 0));
  if (amtEl) amtEl.textContent = totals.orderDiscountAmt ? '- ' + formatCurrency(totals.orderDiscountAmt) : formatCurrency(0);
}

function setTendered(v) {
  if (!tenderedInput) return;
  tenderedInput.value = v ? String(v) : '';
  updateChangeDisplay();
}

// Redeem-points control inside the Payment modal. Redemption is an operation on
// the finished order, so this is where it lives (the numpad "Loyalty" chip only
// showed on an empty cart). Needs a member and the program enabled; the server
// re-validates and settles the discount authoritatively at checkout.
function renderPaymentLoyalty(customer) {
  const row = document.getElementById('payLoyaltyRow');
  const body = document.getElementById('payLoyaltyBody');
  if (!row || !body) return;
  const rate = Number(loyaltyConfig.redeem_rate || 0);
  // Program off (or points worth nothing) → no redeem UI at all.
  if (!loyaltyConfig.enabled || rate <= 0) { row.style.display = 'none'; return; }
  row.style.display = '';
  if (!state.customerId) {
    body.innerHTML = '<div class="muted">Pick a customer above to redeem their points.</div>';
    return;
  }
  const c = customer || state.customer || {};
  const balance = Number(c.points_balance || 0);
  // Gross = current net + whatever is already redeemed, so the cap stays stable
  // while typing (can't redeem more than the customer has or than the bill).
  const orderTotalGross = calculateTotals().total + Number(state.redeemValue || 0);
  const maxByBill = Math.ceil(orderTotalGross / rate);
  const maxRedeem = Math.max(0, Math.min(balance, maxByBill));
  const applied = Number(state.redeemPoints || 0);
  body.innerHTML = `
    <div class="pay-loyalty-balance">${balance} pts available · 1 pt = ${formatCurrency(rate)}</div>
    <div class="pay-loyalty-controls">
      <input id="payRedeemInput" type="number" min="0" step="1" max="${maxRedeem}" value="${applied || ''}" placeholder="Points" />
      <button class="pay" id="payRedeemMax" type="button">Max (${maxRedeem})</button>
      ${applied ? '<button class="pay" id="payRedeemClear" type="button">Clear</button>' : ''}
      <span class="pay-loyalty-preview">${applied ? '- ' + formatCurrency(applied * rate) : '—'}</span>
    </div>
    ${maxRedeem === 0 ? '<div class="muted">No points to redeem on this order.</div>' : ''}
  `;
  const input = body.querySelector('#payRedeemInput');
  const preview = body.querySelector('.pay-loyalty-preview');
  const apply = () => {
    let p = Math.max(0, Math.floor(Number(input.value) || 0));
    if (p > maxRedeem) { p = maxRedeem; input.value = String(p); }
    state.redeemPoints = p;
    state.redeemValue = p * rate;
    updateTotals();
    updateChangeDisplay();
    if (preview) preview.textContent = p > 0 ? '- ' + formatCurrency(p * rate) : '—';
    return p;
  };
  input?.addEventListener('input', apply);
  body.querySelector('#payRedeemMax')?.addEventListener('click', () => { input.value = String(maxRedeem); apply(); renderPaymentLoyalty(c); });
  body.querySelector('#payRedeemClear')?.addEventListener('click', () => { clearRedemption(); updateChangeDisplay(); renderPaymentLoyalty(c); });
}

// Render immediately from cache, then refresh the balance from the server so the
// panel is accurate even after earlier sales this shift.
async function refreshPaymentLoyalty() {
  renderPaymentLoyalty(state.customer);
  if (!state.customerId) return;
  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(state.customerId)}`, {
      headers: typeof authHeaders === 'function' ? authHeaders() : {}
    });
    if (res.ok) { const c = (await res.json()).customer; state.customer = c; renderPaymentLoyalty(c); }
  } catch (e) { /* keep cached */ }
}

searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderProducts();
});


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
      if (orderTypeSelect) orderTypeSelect.value = orderTypesConfig[0]?.name || 'Dine In';
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
    const escaped = String(customerSearch.value || '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
    customerList.innerHTML = query
      ? `<div class="orders-empty">No customers found for "<strong>${escaped}</strong>".
          <button class="pay primary" style="margin-top:10px;display:inline-flex" id="addAsNewCustomerBtn">+ Add as new customer</button></div>`
      : `<div class="orders-empty">Start typing to search, or fill the Create Customer form below.</div>`;
    const btn = customerList.querySelector('#addAsNewCustomerBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        customerCreateName.value = customerSearch.value;
        customerCreateName.focus();
        customerSearch.value = '';
        renderCustomerList();
      });
    }
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
      setSelectedCustomer(row);
      closeCustomerPicker();
    });
    customerList.appendChild(el);
  });
}

// Single place that records the chosen customer — keeps state.customerId,
// state.customer (for the loyalty balance), the inputs and the pay label in
// sync. Any redemption in progress is cleared, since it belonged to whoever
// was selected before.
function setSelectedCustomer(row) {
  state.customerId = row?.id || null;
  state.customer = row || null;
  if (customerInput) customerInput.value = row?.name || '';
  if (loyaltyInput) loyaltyInput.value = row?.member_id || '';
  clearRedemption();
  updatePaymentCustomerLabel();
  // Refresh the inline order redeem controls if the customer was picked from
  // the order panel, or the payment modal's loyalty panel if inside Pay.
  updateOrderRedeem();
  if (payModal?.classList.contains('active')) refreshPaymentLoyalty();
}

function clearRedemption() {
  state.redeemPoints = 0;
  state.redeemValue = 0;
  updateTotals();
  const input = document.getElementById('orderRedeemInput');
  if (input) input.value = '';
}

// Show/hide the inline redeem controls in the order panel when a customer with
// loyalty is selected (pre-transaction).
function updateOrderRedeem() {
  const row = document.getElementById('orderRedeem');
  if (!row) return;
  const c = state.customer;
  if (c && c.id && Number(c.points_balance) > 0 && Number(loyaltyConfig.redeem_rate || 0) > 0) {
    row.style.display = '';
    document.getElementById('orderRedeemBalance').textContent = `${Number(c.points_balance)} pts`;
    renderOrderRedeemPreview();
  } else {
    row.style.display = 'none';
  }
}

function renderOrderRedeemPreview() {
  const rate = Number(loyaltyConfig.redeem_rate || 0);
  const preview = document.getElementById('orderRedeemPreview');
  if (preview) {
    preview.textContent = state.redeemPoints > 0 ? '- ' + formatCurrency(state.redeemPoints * rate) : '—';
  }
}

// Apply order-redeem input and wire up max/clear buttons for the inline panel.
function applyOrderRedeem() {
  const input = document.getElementById('orderRedeemInput');
  if (!input) return;
  const c = state.customer;
  const rate = Number(loyaltyConfig.redeem_rate || 0);
  if (rate <= 0) return;
  const balance = Number(c?.points_balance || 0);
  const orderTotalGross = calculateTotals().total + Number(state.redeemValue || 0);
  const maxByBill = Math.ceil(orderTotalGross / rate);
  const maxRedeem = Math.max(0, Math.min(balance, maxByBill));
  let p = Math.max(0, Math.floor(Number(input.value) || 0));
  if (p > maxRedeem) { p = maxRedeem; input.value = String(p); }
  state.redeemPoints = p;
  state.redeemValue = p * rate;
  updateTotals();
  updateChangeDisplay();
  renderOrderRedeemPreview();
}

// Loyalty redemption panel — open from the Loyalty chip. Needs a member and an
// order to discount; redemption is validated/settled server-side at checkout.
async function openLoyaltyModal() {
  if (!loyaltyModal) return;
  if (!state.customerId) {
    // No member selected — bounce to the Customer picker (which shows balances
    // and doubles as member-ID search) so they can pick one first.
    openInfo('No customer', 'Pick a customer first — Loyalty redeems that member\'s points.');
    openCustomerModal();
    return;
  }
  loyaltyBody.innerHTML = '<div class="muted">Loading…</div>';
  loyaltyModal.classList.add('active');
  // Re-fetch the latest balance so the panel is accurate even after earlier sales.
  let customer = state.customer;
  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(state.customerId)}`, {
      headers: typeof authHeaders === 'function' ? authHeaders() : {}
    });
    if (res.ok) { customer = (await res.json()).customer; state.customer = customer; }
  } catch (e) { /* fall back to cached */ }
  renderLoyaltyBody(customer);
}

function renderLoyaltyBody(customer) {
  const balance = Number(customer?.points_balance || 0);
  const orderTotalGross = calculateTotals().total + Number(state.redeemValue || 0); // total before this redemption
  const REDEEM_RATE = Number(loyaltyConfig.redeem_rate || 0);
  // Can't redeem more than the customer has, nor more than the bill is worth.
  const maxByBill = REDEEM_RATE > 0 ? Math.ceil(orderTotalGross / REDEEM_RATE) : 0;
  const maxRedeem = Math.max(0, Math.min(balance, maxByBill));
  const applied = Number(state.redeemPoints || 0);
  loyaltyBody.innerHTML = `
    <div class="loyalty-summary">
      <div><strong>${customer?.name || 'Customer'}</strong>${customer?.member_id ? ` · ${customer.member_id}` : ''}</div>
      <div class="loyalty-balance">${balance} pts available</div>
      <div class="muted">1 pt = ${formatCurrency(REDEEM_RATE)} · order ${formatCurrency(orderTotalGross)}</div>
    </div>
    <div class="loyalty-redeem-row">
      <input id="loyaltyPointsInput" type="number" min="0" step="1" max="${maxRedeem}" value="${applied || ''}" placeholder="Points to redeem" />
      <span id="loyaltyRedeemPreview" class="loyalty-preview">${applied ? '- ' + formatCurrency(applied * REDEEM_RATE) : '—'}</span>
    </div>
    <div class="loyalty-actions">
      <button class="pay" id="loyaltyMaxBtn" type="button">Use max (${maxRedeem})</button>
      ${applied ? '<button class="pay" id="loyaltyClearBtn" type="button">Clear</button>' : ''}
      <button class="pay primary" id="loyaltyApplyBtn" type="button">Apply</button>
    </div>
    ${maxRedeem === 0 ? '<div class="muted">Nothing to redeem — no points or empty order.</div>' : ''}
  `;
  const input = loyaltyBody.querySelector('#loyaltyPointsInput');
  const preview = loyaltyBody.querySelector('#loyaltyRedeemPreview');
  const clampPts = () => {
    let p = Math.max(0, Math.floor(Number(input.value) || 0));
    if (p > maxRedeem) { p = maxRedeem; input.value = String(p); }
    preview.textContent = p > 0 ? `- ${formatCurrency(p * REDEEM_RATE)}` : '—';
    return p;
  };
  input.addEventListener('input', clampPts);
  loyaltyBody.querySelector('#loyaltyMaxBtn')?.addEventListener('click', () => { input.value = String(maxRedeem); clampPts(); });
  loyaltyBody.querySelector('#loyaltyClearBtn')?.addEventListener('click', () => {
    clearRedemption();
    closeLoyaltyModal();
    openInfo('Redemption cleared', 'Loyalty discount removed from this order.');
  });
  loyaltyBody.querySelector('#loyaltyApplyBtn')?.addEventListener('click', () => {
    const p = clampPts();
    state.redeemPoints = p;
    state.redeemValue = p * REDEEM_RATE;
    updateTotals();
    closeLoyaltyModal();
  });
}

function closeLoyaltyModal() { loyaltyModal?.classList.remove('active'); }

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

if (closeLoyalty) closeLoyalty.addEventListener('click', closeLoyaltyModal);
loyaltyModal?.addEventListener('click', (event) => {
  if (event.target === loyaltyModal) closeLoyaltyModal();
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
        phone: customerCreatePhone.value.trim(),
        email: customerCreateEmail.value.trim()
      };
      const result = await createCustomerRecord(payload);
      setSelectedCustomer(result.customer || { name: payload.name });
      closeCustomerPicker();
    } catch (err) {
      openInfo('Create failed', err.message || 'Failed to create customer.');
    }
  });
}

if (clearCustomer) {
  clearCustomer.addEventListener('click', () => {
    setSelectedCustomer(null);
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

let customerLookupTimer = null;

if (customerInput) {
  customerInput.addEventListener('click', async () => {
    const val = customerInput.value.trim();
    // Always search DB first — if the field has text and we find an exact match,
    // auto-select silently. Only open the modal when we couldn't find one.
    try {
      const q = val ? `?q=${encodeURIComponent(val)}` : '';
      const res = await fetch(`/api/customers${q}`, {
        headers: typeof authHeaders === 'function' ? authHeaders() : {}
      });
      if (!res.ok) { openCustomerModal(); return; }
      const data = await res.json();
      const rows = data.customers || [];
      if (val && rows.length === 1) {
        const row = rows[0];
        const nameMatch = row.name?.toLowerCase() === val.toLowerCase();
        const phoneMatch = row.phone?.replace(/[^0-9]/g, '') === val.replace(/[^0-9]/g, '');
        if (nameMatch || phoneMatch) {
          setSelectedCustomer(row);
          return; // exact match — found, don't open modal
        }
      }
      // No exact match found — open the picker so the user can choose or create.
    } catch (_) { /* fall through to modal */ }
    openCustomerModal();
  });
  customerInput.addEventListener('input', () => {
    // Free-typing — clear any previous selection first.
    state.customerId = null;
    state.customer = null;
    if (loyaltyInput) loyaltyInput.value = '';
    clearRedemption();
    updatePaymentCustomerLabel();
    updateOrderRedeem();
    // Debounced server lookup: if the typed name matches one customer, auto-fill.
    clearTimeout(customerLookupTimer);
    const val = customerInput.value.trim();
    if (val.length < 2) return; // too short to search
    customerLookupTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(val)}`, {
          headers: typeof authHeaders === 'function' ? authHeaders() : {}
        });
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.customers || [];
        // Only auto-fill when exactly one match and it's close to the typed text
        if (rows.length === 1) {
          const row = rows[0];
          const nameMatch = row.name?.toLowerCase() === val.toLowerCase();
          if (nameMatch || row.phone?.replace(/[^0-9]/g, '') === val.replace(/[^0-9]/g, '')) {
            setSelectedCustomer(row);
            // Update the member ID field explicitly (setSelectedCustomer already does this)
          }
        }
      } catch (_) { /* silent */ }
    }, 400);
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
      setSelectedCustomer(row);
    } catch (err) {
      openInfo('Lookup failed', err.message || 'Failed to lookup member.');
    }
  });
}

// Cancel the current order — if it was already sent to the bar, tell the
// kitchen to drop it, then clear the register. (Reachable from the footer
// "⋯" Order Actions sheet.)
function cancelCurrentOrder() {
  if (state.sentToKitchen && state.currentOrderId) {
    sendOrderToKitchen(state.orderLabel || 'Direct Sale', state.order, 'cancel', state.currentOrderId);
  }
  resetOrderState();
  openInfo('Cancelled', 'Order has been cancelled.');
}

function editOrderName() {
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
}

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
  if (action === 'void') {
    openVoidModal();
    return;
  }
  if (action === 'loyalty') {
    openLoyaltyModal();
    return;
  }
  if (action === 'set_table') {
    handleSetTable();
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
  if (action === 'more_actions') {
    moreActionsModal?.classList.add('active');
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
  paymentType.addEventListener('change', () => { updatePayKeypadVisibility(); updateChangeDisplay(); });
}

if (tenderedInput) {
  tenderedInput.addEventListener('input', updateChangeDisplay);
}

// On-screen keypad (replaces the order-panel numpad). Two modes: Tender types
// the cash given; % types a whole-order discount that reduces the amount due.
function applyKeypadDigit(current, key) {
  let cur = String(current || '').replace(/[^0-9]/g, '');
  if (cur === '0') cur = '';
  if (key === 'del') cur = cur.slice(0, -1);
  else if (key === 'clear') cur = '';
  else if (key === '00') cur = cur ? cur + '00' : '';
  else if (key === '000') cur = cur ? cur + '000' : '';
  else cur = cur + key;
  return cur.replace(/^0+(?=\d)/, ''); // no leading zeros
}

document.getElementById('payKeypad')?.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  if (btn.dataset.mode) { setPayMode(btn.dataset.mode); return; }
  const key = btn.dataset.key;
  if (payMode === 'discount') {
    const cur = applyKeypadDigit(String(Math.round(Number(state.orderDiscount) || 0)), key);
    state.orderDiscount = Math.max(0, Math.min(100, Number(cur) || 0));
    updateTotals();          // refreshes summary + amount due
    renderDiscountView();
    updateChangeDisplay();
    refreshPaymentLoyalty();  // redeem cap depends on the discounted total
  } else {
    setTendered(applyKeypadDigit(tenderedInput?.value, key));
  }
});

// Quick-cash: Exact sets the amount due; +50k/+100k add common notes.
document.getElementById('payQuickCash')?.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  setPayMode('tender');
  const kind = btn.dataset.cash;
  if (kind === 'exact') {
    setTendered(Math.round(calculateTotals().total));
  } else {
    const cur = Math.round(parseAmount(tenderedInput?.value));
    setTendered(cur + Number(kind));
  }
});

// Inline redeem controls in the order panel.
document.getElementById('orderRedeemInput')?.addEventListener('input', applyOrderRedeem);
document.getElementById('orderRedeemMax')?.addEventListener('click', () => {
  const c = state.customer;
  const rate = Number(loyaltyConfig.redeem_rate || 0);
  if (rate <= 0) return;
  const balance = Number(c?.points_balance || 0);
  const orderTotalGross = calculateTotals().total + Number(state.redeemValue || 0);
  const maxRedeem = Math.max(0, Math.min(balance, Math.ceil(orderTotalGross / rate)));
  const input = document.getElementById('orderRedeemInput');
  if (input) { input.value = String(maxRedeem); applyOrderRedeem(); }
  updateOrderRedeem();
});
document.getElementById('orderRedeemClear')?.addEventListener('click', () => {
  clearRedemption();
  const input = document.getElementById('orderRedeemInput');
  if (input) input.value = '';
  updateOrderRedeem();
});

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
  // Delivery-platform per-item charge (Grab Food / Go Food) is folded into the
  // per-unit price sent, same as the per-line % discount, so the recorded sale
  // equals the net Total shown here (thumbaz's /api/sales has no per-item
  // charge concept of its own).
  const perItemCharge = deliveryPerItem();
  const payload = {
    items: state.order.map((item) => {
      const discountFrac = Math.max(0, Math.min(1, Number(item.discount || 0) / 100));
      const price = Math.max(0, Math.round(item.price * (1 - discountFrac)) - perItemCharge);
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
        modifiers,
        extra_ingredients: (item.extra_ingredients || []).map((ing) => ({
          ingredient_id: ing.ingredient_id,
          qty_base: ing.qty_base
        }))
      };
    }),
    payment_type: method,
    order_type: getOrderTypeValue(),
    amount_tendered: method === 'cash' ? tendered : null,
    note: transactionNote?.value.trim() || '',
    customer_id: state.customerId || null,
    redeem_points: state.customerId ? Number(state.redeemPoints || 0) : 0,
    discount_pct: Math.max(0, Math.min(100, Number(state.orderDiscount || 0)))
  };

  let saleId = null;
  let earnedPoints = 0;
  let redeemedPoints = 0;
  let customerAfter = null;
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
    earnedPoints = Number(data.points_earned || 0);
    redeemedPoints = Number(data.redeem_points || 0);
    customerAfter = data.customer || null;
    if (saleId) {
      localStorage.setItem(LAST_SALE_KEY, String(saleId));
      // Stash a summary so "Void Last Sale" can show WHICH sale it will void
      // (id, items, total, time) instead of voiding blindly.
      const s = data.sale || {};
      const total = (s.items || []).reduce((sum, i) => sum + Number(i.total || 0), 0);
      const summary = {
        id: saleId,
        total,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: (s.items || []).map((i) => `${i.quantity}× ${i.name}`)
      };
      localStorage.setItem(LAST_SALE_SUMMARY_KEY, JSON.stringify(summary));
    }
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
  if (receiptNote) {
    const noteText = transactionNote?.value.trim();
    if (noteText) {
      receiptNote.textContent = `Note: ${noteText}`;
      receiptNote.classList.remove('hidden');
    } else {
      receiptNote.classList.add('hidden');
    }
  }
  if (receiptLoyalty) {
    if (customerAfter) {
      const parts = [];
      if (redeemedPoints > 0) parts.push(`-${redeemedPoints} redeemed`);
      if (earnedPoints > 0) parts.push(`+${earnedPoints} earned`);
      const movement = parts.length ? `${parts.join(', ')} · ` : '';
      receiptLoyalty.textContent = `Loyalty: ${movement}balance ${customerAfter.points_balance} pts`;
      receiptLoyalty.classList.remove('hidden');
    } else {
      receiptLoyalty.classList.add('hidden');
    }
  }
  if (receiptTime) receiptTime.textContent = time;
  if (receiptCashier) receiptCashier.textContent = `Served by: ${auth?.name || 'Cashier'}`;
  if (receiptFooterText) receiptFooterText.textContent = settings.receiptFooter || 'Thank you!';
  if (receiptLogoImg && receiptLogoText) {
    // Always show the 8 NewLight logo (custom logoUrl if configured, else the
    // high-contrast black receipt logo baked in for thermal printing).
    receiptLogoImg.src = settings.logoUrl || '/receipt-logo.png';
    receiptLogoImg.parentElement?.classList.add('has-image');
    receiptLogoText.textContent = settings.storeName || '8 NewLight';
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
  if (transactionNote) transactionNote.value = '';
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
  // Clear the customer link now that the sale (and its receipt) is done — the
  // receipt above already rendered with this customer, so it's safe to reset
  // before the NEXT order starts fresh instead of inheriting this one.
  state.customerId = null;
  state.customer = null;
  state.redeemPoints = 0;
  state.redeemValue = 0;
  state.orderDiscount = 0;
  if (customerInput) customerInput.value = '';
  if (loyaltyInput) loyaltyInput.value = '';
  updatePaymentCustomerLabel();
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
      <div>
        <label>Deducts recipe of</label>
        <select class="select" data-field="product">${productOptionsHtml(mod.product_id)}</select>
      </div>
      <button class="pay" data-action="save" data-id="${mod.id}">Save</button>
      <button class="pay" data-action="delete" data-id="${mod.id}">Disable</button>
      <div class="modifier-margin muted" data-role="margin">${modifierMarginHint(mod.price_delta, mod.product_id)}</div>
    `;
    // Live-update the cost/margin hint as the price or linked product changes.
    const marginEl = row.querySelector('[data-role="margin"]');
    const priceEl = row.querySelector('input[data-field="price"]');
    const productEl = row.querySelector('select[data-field="product"]');
    const refresh = () => { marginEl.textContent = modifierMarginHint(priceEl.value, productEl.value); };
    priceEl.addEventListener('input', refresh);
    productEl.addEventListener('change', refresh);
    manageModifierList.appendChild(row);
  });
}

async function openManageModifiers() {
  if (!manageModifiersModal) return;
  manageModifiersModal.classList.add('active');
  if (newModifierProduct) newModifierProduct.innerHTML = productOptionsHtml('');
  if (newModifierMargin) newModifierMargin.textContent = '';
  manageModifierList.innerHTML = '<div class="muted">Loading…</div>';
  const modifiers = await refreshModifiers();
  renderManageModifierList(modifiers);
}

// Keep the "new modifier" margin hint live as its price / product change.
function refreshNewModifierMargin() {
  if (!newModifierMargin) return;
  newModifierMargin.textContent = modifierMarginHint(
    newModifierPrice ? newModifierPrice.value : 0,
    newModifierProduct ? newModifierProduct.value : ''
  );
}
newModifierPrice?.addEventListener('input', refreshNewModifierMargin);
newModifierProduct?.addEventListener('change', refreshNewModifierMargin);

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

// ---- Loyalty Setup (manager-only): edit how points are earned/redeemed ----
const loyaltySetupBtn = document.getElementById('loyaltySetupBtn');
const loyaltySetupModal = document.getElementById('loyaltySetupModal');
const closeLoyaltySetup = document.getElementById('closeLoyaltySetup');
const loyaltyEnabledInput = document.getElementById('loyaltyEnabled');
const loyaltyEarnPointsInput = document.getElementById('loyaltyEarnPoints');
const loyaltyEarnBaseInput = document.getElementById('loyaltyEarnBase');
const loyaltyRedeemRateInput = document.getElementById('loyaltyRedeemRate');
const loyaltySetupPreview = document.getElementById('loyaltySetupPreview');
const loyaltySetupBadge = document.getElementById('loyaltySetupBadge');
const loyaltySetupUpdated = document.getElementById('loyaltySetupUpdated');
const loyaltyEarnCard = document.getElementById('loyaltyEarnCard');
const loyaltyRedeemCard = document.getElementById('loyaltyRedeemCard');
const loyaltyEarnExample = document.getElementById('loyaltyEarnExample');
const loyaltyRedeemExample = document.getElementById('loyaltyRedeemExample');
const resetLoyaltySetup = document.getElementById('resetLoyaltySetup');
const saveLoyaltySetup = document.getElementById('saveLoyaltySetup');

// Historical defaults — what the program shipped with before it became
// configurable. Used to seed a fresh install and by "Reset to Defaults".
const LOYALTY_SETUP_DEFAULTS = { enabled: true, earn_points: 1, earn_base: 10000, redeem_rate: 100 };

function formatLoyaltyUpdatedAt(value) {
  if (!value) return 'Never edited — using defaults.';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return `Last updated ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderLoyaltySetupPreview() {
  if (!loyaltySetupPreview) return;
  const base = Math.max(0, Number(loyaltyEarnBaseInput.value) || 0);
  const pts = Math.max(0, Number(loyaltyEarnPointsInput.value) || 0);
  const rate = Math.max(0, Number(loyaltyRedeemRateInput.value) || 0);
  const on = loyaltyEnabledInput.checked;

  if (loyaltySetupBadge) {
    loyaltySetupBadge.textContent = on ? 'Active' : 'Inactive';
    loyaltySetupBadge.classList.toggle('off', !on);
  }
  loyaltyEarnCard?.classList.toggle('is-off', !on);
  loyaltyRedeemCard?.classList.toggle('is-off', !on);

  if (loyaltyEarnExample) {
    loyaltyEarnExample.textContent = base > 0
      ? `Rp 10,000 order → ${Math.floor(10000 / base) * pts} pt${Math.floor(10000 / base) * pts === 1 ? '' : 's'} earned`
      : 'Set a spend amount to earn points';
  }
  if (loyaltyRedeemExample) {
    loyaltyRedeemExample.textContent = rate > 0
      ? `10 points → ${formatCurrency(rate * 10)} off`
      : 'Redemption disabled (Rp0 off)';
  }

  if (!on) {
    loyaltySetupPreview.textContent = 'Program off — no points earned or redeemed on new sales.';
    return;
  }
  const earnMsg = base > 0 ? `Spend ${formatCurrency(base)} → earn ${pts} pt${pts === 1 ? '' : 's'}.` : 'Set a spend amount to earn points.';
  const redeemMsg = rate > 0 ? ` Each point is worth ${formatCurrency(rate)} off.` : ' Redemption disabled (1 pt = Rp0).';
  loyaltySetupPreview.textContent = earnMsg + redeemMsg;
}

function populateLoyaltySetupFields(config) {
  loyaltyEnabledInput.checked = !!config.enabled;
  loyaltyEarnPointsInput.value = String(config.earn_points ?? 1);
  loyaltyEarnBaseInput.value = String(config.earn_base ?? 10000);
  loyaltyRedeemRateInput.value = String(config.redeem_rate ?? 100);
  if (loyaltySetupUpdated) loyaltySetupUpdated.textContent = formatLoyaltyUpdatedAt(config.updated_at);
  renderLoyaltySetupPreview();
}

function openLoyaltySetup() {
  if (!loyaltySetupModal) return;
  populateLoyaltySetupFields(loyaltyConfig);
  loyaltySetupModal.classList.add('active');
}

[loyaltyEnabledInput, loyaltyEarnPointsInput, loyaltyEarnBaseInput, loyaltyRedeemRateInput]
  .forEach((el) => el?.addEventListener('input', renderLoyaltySetupPreview));

resetLoyaltySetup?.addEventListener('click', () => {
  // Only resets the form — nothing is persisted until Save is pressed.
  populateLoyaltySetupFields({ ...LOYALTY_SETUP_DEFAULTS, updated_at: loyaltyConfig.updated_at });
});

if (loyaltySetupBtn) {
  const canManage = auth && ['admin', 'manager'].includes(auth.role);
  if (!canManage) {
    loyaltySetupBtn.style.display = 'none';
  } else {
    loyaltySetupBtn.addEventListener('click', openLoyaltySetup);
  }
}

closeLoyaltySetup?.addEventListener('click', () => loyaltySetupModal.classList.remove('active'));
loyaltySetupModal?.addEventListener('click', (event) => {
  if (event.target === loyaltySetupModal) loyaltySetupModal.classList.remove('active');
});

saveLoyaltySetup?.addEventListener('click', async () => {
  const earnBase = Math.floor(Number(loyaltyEarnBaseInput.value));
  const earnPoints = Math.floor(Number(loyaltyEarnPointsInput.value));
  const redeemRate = Math.floor(Number(loyaltyRedeemRateInput.value));
  if (!Number.isFinite(earnBase) || earnBase < 1) {
    openInfo('Invalid setup', 'The spend amount to earn points must be at least Rp1.');
    return;
  }
  if (!Number.isFinite(earnPoints) || earnPoints < 0 || !Number.isFinite(redeemRate) || redeemRate < 0) {
    openInfo('Invalid setup', 'Points and redemption value cannot be negative.');
    return;
  }
  try {
    const res = await fetch('/api/loyalty-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
      body: JSON.stringify({
        enabled: loyaltyEnabledInput.checked,
        earn_base: earnBase,
        earn_points: earnPoints,
        redeem_rate: redeemRate
      })
    });
    if (!res.ok) throw new Error('save failed');
    const data = await res.json();
    if (data && data.config) {
      loyaltyConfig = data.config;
      if (loyaltySetupUpdated) loyaltySetupUpdated.textContent = formatLoyaltyUpdatedAt(loyaltyConfig.updated_at);
    }
    loyaltySetupModal.classList.remove('active');
    updateTotals();
    openInfo('Loyalty updated', 'The loyalty program rules have been saved.');
  } catch (_) {
    openInfo('Save failed', 'Could not save the loyalty setup. Please try again.');
  }
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
      const productId = newModifierProduct && newModifierProduct.value ? Number(newModifierProduct.value) : null;
      const res = await fetch('/api/modifiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
        body: JSON.stringify({ name, price_delta: price, product_id: productId })
      });
      if (!res.ok) throw new Error('Failed to add modifier.');
      newModifierName.value = '';
      newModifierPrice.value = '';
      if (newModifierProduct) newModifierProduct.value = '';
      if (newModifierMargin) newModifierMargin.textContent = '';
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
      const productSelect = row ? row.querySelector('select[data-field="product"]') : null;
      const productId = productSelect && productSelect.value ? Number(productSelect.value) : null;
      if (!name || !Number.isFinite(price)) {
        openInfo('Missing info', 'Name and price are required.');
        return;
      }
      try {
        const res = await fetch(`/api/modifiers/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
          body: JSON.stringify({ name, price_delta: price, product_id: productId })
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

// Void a Sale — pick any sale from this shift, choose whether to return the
// ingredients (Yes = not made yet, No = already produced), then manager PIN +
// reason. Replaces the old "void the last one, always restock" behavior.
const voidModal = document.getElementById('voidModal');
const voidList = document.getElementById('voidList');
const closeVoid = document.getElementById('closeVoid');

async function openVoidModal() {
  if (!voidModal) return;
  voidModal.classList.add('active');
  voidList.innerHTML = '<div class="muted">Loading…</div>';
  let sales = [];
  try {
    const res = await fetch('/api/sales', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    sales = res.ok ? await res.json() : [];
  } catch (e) { sales = []; }
  renderVoidList(sales);
}

function renderVoidList(sales) {
  if (!sales.length) {
    voidList.innerHTML = '<div class="muted">No sales this shift.</div>';
    return;
  }
  voidList.innerHTML = '';
  sales.forEach((s) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'void-sale-row';
    row.innerHTML = `
      <div class="void-sale-main"><strong>#${s.id}</strong> <span class="muted">${s.items || ''}</span></div>
      <div class="void-sale-total">${formatCurrency(s.total)}</div>`;
    row.addEventListener('click', () => showVoidConfirm(s));
    voidList.appendChild(row);
  });
}

function showVoidConfirm(sale) {
  voidList.innerHTML = `
    <div class="void-confirm">
      <div class="void-confirm-title">Void Sale #${sale.id}</div>
      <div class="muted">${sale.items || ''} · Total ${formatCurrency(sale.total)}</div>
      <div class="void-confirm-q">Return ingredients to stock?</div>
      <div class="void-confirm-actions">
        <button class="pay" data-restock="yes" type="button">Yes — not made</button>
        <button class="pay" data-restock="no" type="button">No — already made</button>
      </div>
      <button class="ghost void-back" type="button">← Back to list</button>
    </div>`;
  voidList.querySelector('.void-back').addEventListener('click', openVoidModal);
  voidList.querySelectorAll('[data-restock]').forEach((b) => {
    b.addEventListener('click', () => {
      voidModal.classList.remove('active');
      submitVoid(sale, b.dataset.restock === 'yes');
    });
  });
}

function submitVoid(sale, restock) {
  openPrompt({
    title: `Void Sale #${sale.id}`,
    label: 'Manager PIN',
    placeholder: 'PIN',
    hint: `${sale.items || ''} · Total ${formatCurrency(sale.total)}. ${restock ? 'Ingredients WILL return to stock (not made).' : 'Inventory stays consumed (already made).'} Enter manager PIN.`,
    onSave: (pin) => {
      if (!pin) { openInfo('PIN required', 'Enter the manager PIN to void.'); return; }
      openPrompt({
        title: 'Void Reason',
        label: 'Reason',
        placeholder: 'e.g. Wrong item, customer changed mind',
        hint: 'Add a short reason for this void.',
        onSave: async (reason) => {
          try {
            const res = await fetch(`/api/sales/${encodeURIComponent(sale.id)}/void`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(typeof authHeaders === 'function' ? authHeaders() : {}) },
              body: JSON.stringify({ manager_pin: pin, reason: reason || '', restock })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Void failed.');
            if (String(localStorage.getItem(LAST_SALE_KEY)) === String(sale.id)) {
              localStorage.removeItem(LAST_SALE_KEY);
              localStorage.removeItem(LAST_SALE_SUMMARY_KEY);
            }
            openInfo('Voided', data.message || 'Sale voided.');
          } catch (err) {
            openInfo('Void failed', err.message || 'Void failed.');
          }
        }
      });
    }
  });
}

if (closeVoid) closeVoid.addEventListener('click', () => voidModal.classList.remove('active'));
voidModal?.addEventListener('click', (event) => { if (event.target === voidModal) voidModal.classList.remove('active'); });

// "⋯ More" action sheet — opened from the numpad footer. Routes to the existing
// (mostly hidden) action-grid buttons so their logic isn't duplicated. Hold is
// intentionally omitted (the Orders tab it parks into is hidden).
const moreActionsModal = document.getElementById('moreActionsModal');
const closeMoreActions = document.getElementById('closeMoreActions');
function closeMoreActionsModal() { moreActionsModal?.classList.remove('active'); }
if (closeMoreActions) closeMoreActions.addEventListener('click', closeMoreActionsModal);
moreActionsModal?.addEventListener('click', (event) => {
  if (event.target === moreActionsModal) { closeMoreActionsModal(); return; }
  const btn = event.target.closest('button[data-more]');
  if (!btn) return;
  closeMoreActionsModal();
  switch (btn.dataset.more) {
    case 'void': openVoidModal(); break;
    case 'split': if (splitBtn) splitBtn.click(); break;
    case 'invoice': openInfo('Coming soon', 'Invoices aren\'t wired up in this concept yet.'); break;
    case 'set_table': handleSetTable(); break;
    case 'edit_name': editOrderName(); break;
    case 'cancel': cancelCurrentOrder(); break;
  }
});

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
  // Show which sale is about to be voided (id, items, total, time) so the
  // cashier isn't voiding blindly.
  let summary = null;
  try { summary = JSON.parse(localStorage.getItem(LAST_SALE_SUMMARY_KEY) || 'null'); } catch (e) { /* ignore */ }
  const detail = summary && summary.items
    ? `${summary.items.join(', ')} · Total ${formatCurrency(summary.total)}${summary.time ? ' · ' + summary.time : ''}`
    : `Sale #${lastSaleId}`;
  openPrompt({
    title: `Void Sale #${lastSaleId}`,
    label: 'Manager PIN',
    value: '',
    placeholder: 'PIN',
    hint: `Voiding: ${detail}. Enter manager PIN to confirm.`,
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
            localStorage.removeItem(LAST_SALE_SUMMARY_KEY);
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
  refundBtn.addEventListener('click', openVoidModal);
}

// Add Custom Item — a one-off line not tied to a real menu product. The modal
// captures name + price and an optional on-the-fly recipe (ingredient + qty
// lines) that deduct inventory at checkout via the sale's extra_ingredients.
const customItemModal = document.getElementById('customItemModal');
const customItemName = document.getElementById('customItemName');
const customItemPrice = document.getElementById('customItemPrice');
const addCustomIngredientBtn = document.getElementById('addCustomIngredientBtn');
const customRecipeList = document.getElementById('customRecipeList');
const customRecipeCost = document.getElementById('customRecipeCost');
const confirmCustomItem = document.getElementById('confirmCustomItem');
const closeCustomItem = document.getElementById('closeCustomItem');
const cancelCustomItem = document.getElementById('cancelCustomItem');

let posIngredientsCache = null;
async function fetchPosIngredients() {
  if (posIngredientsCache) return posIngredientsCache;
  try {
    const res = await fetch('/api/pos-ingredients', { headers: typeof authHeaders === 'function' ? authHeaders() : {} });
    posIngredientsCache = res.ok ? await res.json() : [];
  } catch (err) {
    posIngredientsCache = [];
  }
  return posIngredientsCache;
}

function ingredientOptionsHtml(selectedId) {
  const opts = ['<option value="">Select ingredient…</option>'];
  (posIngredientsCache || []).forEach((ing) => {
    const sel = Number(selectedId) === Number(ing.id) ? ' selected' : '';
    const nm = String(ing.name || '').replace(/</g, '&lt;');
    opts.push(`<option value="${ing.id}"${sel}>${nm} (${ing.base_unit})</option>`);
  });
  return opts.join('');
}

function customRecipeRows() {
  return Array.from(customRecipeList.querySelectorAll('.custom-recipe-row')).map((row) => {
    const sel = row.querySelector('select[data-field="ingredient"]');
    const qtyEl = row.querySelector('input[data-field="qty"]');
    const ingredientId = sel && sel.value ? Number(sel.value) : null;
    const qty = qtyEl ? Number(qtyEl.value) : 0;
    const ing = (posIngredientsCache || []).find((i) => Number(i.id) === ingredientId);
    return { ingredientId, qty, ing };
  });
}

function updateCustomRecipeCost() {
  let cost = 0;
  customRecipeRows().forEach(({ qty, ing }) => {
    if (ing && qty > 0) cost += Number(ing.std_cost_per_base || 0) * qty;
  });
  cost = Math.round(cost);
  const price = Math.round(Number(customItemPrice.value || 0));
  const margin = price - cost;
  const pct = price > 0 ? Math.round((margin / price) * 100) : 0;
  customRecipeCost.textContent = price > 0 || cost > 0
    ? `Recipe cost: ${formatCurrency(cost)} · margin ${formatCurrency(margin)} (${pct}%)`
    : 'Recipe cost: Rp 0 · margin —';
}

function addCustomRecipeRow(selectedId, qty) {
  const row = document.createElement('div');
  row.className = 'custom-recipe-row';
  row.innerHTML = `
    <select class="select" data-field="ingredient">${ingredientOptionsHtml(selectedId)}</select>
    <input type="number" step="0.01" min="0" data-field="qty" placeholder="Qty" value="${qty || ''}" />
    <button class="ghost" type="button" data-action="remove">✕</button>
  `;
  row.querySelector('[data-action="remove"]').addEventListener('click', () => { row.remove(); updateCustomRecipeCost(); });
  row.querySelector('select').addEventListener('change', updateCustomRecipeCost);
  row.querySelector('input').addEventListener('input', updateCustomRecipeCost);
  customRecipeList.appendChild(row);
}

async function openCustomItemModal() {
  if (!customItemModal) return;
  if (!customProductId) {
    openInfo('Not configured', 'No "Custom Item" product found in the menu.');
    return;
  }
  await fetchPosIngredients();
  const customCount = state.order.filter((row) => row.isCustom).length + 1;
  customItemName.value = `Custom Item ${customCount}`;
  customItemPrice.value = '';
  customRecipeList.innerHTML = '';
  updateCustomRecipeCost();
  customItemModal.classList.add('active');
  customItemName.focus();
}

function closeCustomItemModal() { customItemModal?.classList.remove('active'); }

if (addCustomItemBtn) addCustomItemBtn.addEventListener('click', openCustomItemModal);
if (addCustomIngredientBtn) addCustomIngredientBtn.addEventListener('click', () => addCustomRecipeRow('', ''));
if (customItemPrice) customItemPrice.addEventListener('input', updateCustomRecipeCost);
if (closeCustomItem) closeCustomItem.addEventListener('click', closeCustomItemModal);
if (cancelCustomItem) cancelCustomItem.addEventListener('click', closeCustomItemModal);
customItemModal?.addEventListener('click', (event) => { if (event.target === customItemModal) closeCustomItemModal(); });

if (confirmCustomItem) {
  confirmCustomItem.addEventListener('click', () => {
    const name = (customItemName.value || '').trim() || 'Custom Item';
    const price = Math.max(0, Math.round(Number(customItemPrice.value || 0)));
    // Collect valid recipe lines; skip empty/incomplete rows.
    const extra = customRecipeRows()
      .filter(({ ingredientId, qty }) => ingredientId && qty > 0)
      .map(({ ingredientId, qty, ing }) => ({
        ingredient_id: ingredientId,
        qty_base: qty,
        name: ing ? ing.name : '',
        base_unit: ing ? ing.base_unit : ''
      }));
    const line = {
      lineId: crypto.randomUUID(),
      id: customProductId,
      name,
      price,
      qty: 1,
      note: '',
      discount: 0,
      modifiers: [],
      extra_ingredients: extra,
      isCustom: true
    };
    state.order.push(line);
    state.selectedLineId = line.lineId;
    state.inputMode = 'qty';
    state.buffer = '';
    closeCustomItemModal();
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
  orderTypeSelect.value = normalizeOrderType(settings.orderType);
  orderTypeSelect.addEventListener('change', () => {
    setOrderType(orderTypeSelect.value);
    updateTotals(); // delivery-platform charge depends on the selected type
  });
  setOrderType(orderTypeSelect.value);
}
loadOrderTypes();
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
// Default the receipt logo up-front so held/re-printed receipts show it too
// (checkout re-applies it, honouring a custom logoUrl if configured).
if (receiptLogoImg) {
  receiptLogoImg.src = settings.logoUrl || '/receipt-logo.png';
  receiptLogoImg.parentElement?.classList.add('has-image');
}
loadLoyaltyConfig().then(() => {
  updateTotals();
  // Deep link from the sidebar's "Customers & Loyalty" > Loyalty Setup entry.
  if (location.hash === '#loyalty-setup') {
    history.replaceState(null, '', location.pathname + location.search);
    const canManage = auth && ['admin', 'manager'].includes(auth.role);
    if (canManage) openLoyaltySetup();
  }
});
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
