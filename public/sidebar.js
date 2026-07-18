(() => {
  const s = document.getElementById('sidebar');
  if (!s) return;
  const brand = s.querySelector('.sidebar-brand');
  s.innerHTML = '';
  if (brand) s.appendChild(brand);
  const items = [
    { type: 'group', label: '📊  Management', children: [
      { href: '/dashboard.html', label: 'Overview' },
      { href: '/system-report.html', label: 'Analytics' },
      { href: '/transactions.html', label: 'Transactions' },
      { href: '/budget.html', label: 'Budget' },
    ]},
    { type: 'group', label: '🛒  POS', children: [
      { href: '/pos/ui/1/register', label: 'Register' },
      { href: '/kitchen.html', label: 'Kitchen' },
      { href: '/order-types.html', label: 'Order Types' },
      { href: '/printer-setup.html', label: 'Printer' },
      { href: '/customers.html', label: 'Customers' },
      { href: '/pos/ui/1/register#loyalty-setup', label: 'Loyalty Setup' },
    ]},
    { type: 'link', href: '/inventory.html', label: '📦  Inventory' },
    { type: 'divider' },
    { type: 'group', label: '📋  Product', children: [
      { href: '/menu.html', label: 'Menu Items' },
      { href: '/receipe.html', label: 'Recipe' },
      { href: '/ingredients.html', label: 'Ingredients' },
    ]},
    { type: 'group', label: '💰  Purchase', children: [
      { href: '/purchase.html', label: 'Purchases' },
      { href: '/expenses.html', label: 'Expenses' },
      { href: '/supplier.html', label: 'Suppliers' },
    ]},
    { type: 'divider' },
    { type: 'group', label: '👥  Employee', children: [
      { href: '/payroll.html', label: 'Payroll' },
      { href: '/clock.html', label: 'Attendance' },
    ]},
    { type: 'group', label: '⚙️  Setup', children: [
      { href: '/employees.html', label: 'Users' },
      { href: '/import-center.html', label: 'Import Center' },
    ]},
    { type: 'divider' },
    { type: 'link', href: '/logout.html', label: '🚪  Logout' },
  ];
  items.forEach(item => {
    if (item.type === 'divider') {
      const d = document.createElement('div'); d.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:6px 4px;'; s.appendChild(d);
    } else if (item.type === 'group') {
      const g = document.createElement('div'); g.className = 'nav-group';
      const btn = document.createElement('button'); btn.className = 'nav-toggle'; btn.type = 'button';
      btn.innerHTML = '<span>'+item.label+'</span><span class="chevron"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>';
      g.appendChild(btn);
      const ch = document.createElement('div'); ch.className = 'nav-children';
      item.children.forEach(c => {
        const a = document.createElement('a'); a.setAttribute('href', c.href); a.className = 'nav-sub'; a.textContent = c.label; ch.appendChild(a);
      });
      g.appendChild(ch);
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => { g.classList.toggle('open'); });
      s.appendChild(g);
      // Auto-open group containing current page
      if (location.pathname === item.children[0].href || item.children.some(c => location.pathname === c.href)) g.classList.add('open');
    } else if (item.type === 'link') {
      const a = document.createElement('a'); a.setAttribute('href', item.href); a.textContent = item.label;
      if (location.pathname === item.href) a.style.cssText = 'background:var(--brand);color:#fff!important;font-weight:700;';
      s.appendChild(a);
    }
  });
})();

(() => {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menuToggle');
  if (!sidebar || !toggle) return;

  function getAuth() {
    try {
      const raw = localStorage.getItem('pos_auth');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function addHomeLink() {
    if (sidebar.querySelector('a[href="/home.html"][data-home="1"]')) return;
    const auth = getAuth() || {};
    const home = document.createElement('a');
    home.href = auth.role === 'staff' ? '/pos/ui/1/register' : '/dashboard.html';
    home.dataset.home = '1';
    home.textContent = 'Home';
    // Insert as the first top-level nav item (after the brand) so it does not
    // land inside the first group's children list.
    const brandEl = sidebar.querySelector('.sidebar-brand');
    if (brandEl) {
      sidebar.insertBefore(home, brandEl.nextSibling);
    } else {
      sidebar.insertBefore(home, sidebar.firstChild);
    }
  }

  function filterLinksByRole() {
    const auth = getAuth();
    if (!auth || !auth.role) return;

    if (auth.role === 'staff') {
    const allowed = new Set(['/pos/ui/1/register', '/kitchen.html', '/customers.html', '/clock.html', '/logout.html']);
      sidebar.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (!allowed.has(href)) {
          link.remove();
        }
      });
      return;
    }

    const employeesLink = sidebar.querySelector('a[href="/employees.html"]');
    if (!employeesLink) {
      const reportsLink = sidebar.querySelector('a[href="/report.html"]');
      const link = document.createElement('a');
      link.href = '/employees.html';
      link.textContent = 'Employees';
      if (reportsLink && reportsLink.parentNode) {
        reportsLink.parentNode.insertBefore(link, reportsLink);
      } else {
        sidebar.appendChild(link);
      }
    }
  }

  function buildReportsGroup() {
    const auth = getAuth();
    if (!auth || auth.role === 'staff') return;
    const existing = sidebar.querySelector('.nav-group[data-group=\"reports\"]');
    if (existing) return;
    const reportsLink = sidebar.querySelector('a[href=\"/report.html\"]');
    if (!reportsLink || !reportsLink.parentNode) return;

    const group = document.createElement('div');
    group.className = 'nav-group';
    group.dataset.group = 'reports';
    group.innerHTML = `
      <button class=\"nav-toggle\" type=\"button\" aria-expanded=\"false\">\n        <span>Reports</span>\n        <span class=\"chevron\" aria-hidden=\"true\">\n          <svg viewBox=\"0 0 24 24\"><path d=\"M6 9l6 6 6-6\" /></svg>\n        </span>\n      </button>\n      <div class=\"nav-children\">\n        <a href=\"/report.html\" class=\"nav-sub\">All Reports</a>\n        <a href=\"/report-sales.html\" class=\"nav-sub\">Sales Report</a>\n        <a href=\"/report-transactions.html\" class=\"nav-sub\">Transaction History</a>\n        <a href=\"/report-pnl.html\" class=\"nav-sub\">P&amp;L Report</a>\n        <a href=\"/report-menu.html\" class=\"nav-sub\">Menu COGS</a>\n        <a href=\"/report-recipe.html\" class=\"nav-sub\">Menu Costing</a>\n        <a href=\"/report-category.html\" class=\"nav-sub\">Category Sales</a>\n        <a href=\"/report-shifts.html\" class=\"nav-sub\">Shift Summary</a>\n        <a href="/report-inventory.html" class="nav-sub">Inventory Valuation</a>\n        <a href="/report-usage.html" class="nav-sub">Purchase vs Usage</a>\n        <a href="/report-top.html" class="nav-sub">Top/Bottom Sellers</a>\n        <a href="/report-forecast.html" class="nav-sub">Low Stock Forecast</a>\n      </div>
    `;

    reportsLink.parentNode.replaceChild(group, reportsLink);
  }

  function setupNavGroups() {
    const groups = sidebar.querySelectorAll('.nav-group');
    const currentPath = window.location.pathname;
    groups.forEach(group => {
      const toggle = group.querySelector('.nav-toggle');
      const children = group.querySelectorAll('a[href]');
      if (!children.length) {
        group.remove();
        return;
      }
      children.forEach(link => {
        if (link.getAttribute('href') === currentPath) link.classList.add('active');
      });
      const hasActive = Array.from(children).some(link => link.getAttribute('href') === currentPath);
      if (hasActive) {
        group.classList.add('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
      }
      // A toggle handler may already be bound by the dynamic builder above.
      // Skip re-binding so a single click doesn't toggle 'open' twice (which
      // would cancel out and appear as "the dropdown doesn't work").
      if (!toggle || toggle.dataset.bound) return;
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', () => {
        group.classList.toggle('open');
        const isOpen = group.classList.contains('open');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    });
  }

  addHomeLink();

  const ICONS = {
    '/dashboard.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 20h18" />
        <path d="M6 18v-6" />
        <path d="M12 18v-10" />
        <path d="M18 18v-3" />
      </svg>
    `,
    '/setup.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1" />
      </svg>
    `,
    '/pos/ui/1/register': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
        <path d="M3 4h2l2.4 9.6a2 2 0 0 0 2 1.4h7.6a2 2 0 0 0 2-1.5l1.2-6.5H7.2" />
      </svg>
    `,
    '/clock.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </svg>
    `,
    '/inventory.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7l8-4 8 4-8 4-8-4z" />
        <path d="M4 7v10l8 4 8-4V7" />
        <path d="M12 11v10" />
      </svg>
    `,
    '/menu.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
    `,
    '/receipe.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h10v3H7z" />
        <path d="M6 6h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6z" />
        <path d="M9 10h6M9 14h6" />
      </svg>
    `,
    '/purchase.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4h12v16H6z" />
        <path d="M9 7h6M9 11h6M9 15h4" />
      </svg>
    `,
    '/expenses.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v18" />
        <path d="M8 7h8" />
        <path d="M8 12h8" />
        <path d="M8 17h8" />
      </svg>
    `,
    '/supplier.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h10v10H4z" />
        <path d="M14 10h4l2 3v4h-6z" />
        <path d="M7 17h2M10 17h2M16 17h2" />
      </svg>
    `,
    '/chart.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 20h18" />
        <path d="M5 16l4-4 4 3 6-7" />
        <path d="M18 8h2v6" />
      </svg>
    `,
    '/report.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4h9l3 3v13H6z" />
        <path d="M15 4v4h4" />
        <path d="M9 11h6M9 15h6M9 19h4" />
      </svg>
    `,
    '/employees.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 19c0-3 3-5 6-5s6 2 6 5" />
        <path d="M14 18c.4-2 2.2-3.5 4-3.5 1 0 1.9.3 2.6.9" />
      </svg>
    `,
    '/logout.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
        <path d="M14 16l4-4-4-4" />
        <path d="M18 12H9" />
      </svg>
    `
  };

  function addIcons() {
    sidebar.querySelectorAll('a[href]').forEach(link => {
      if (link.dataset.iconized) return;
      const href = link.getAttribute('href');
      const icon = ICONS[href];
      if (!icon) return;
      const label = link.textContent.trim();
      link.textContent = '';
      link.classList.add('with-icon');
      link.insertAdjacentHTML('afterbegin', `<span class="icon">${icon}</span><span class="label">${label}</span>`);
      link.dataset.iconized = '1';
    });
  }

  function openSidebar() {
    sidebar.classList.add('open');
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  }

  function toggleSidebar() {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  toggle.addEventListener('click', toggleSidebar);

  // Auto-hide overlay: dim backdrop + close on outside-click, nav-click, Esc.
  let backdrop = document.getElementById('sidebarBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }
  backdrop.addEventListener('click', closeSidebar);
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) closeSidebar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // Start hidden everywhere; the menu button opens it as an overlay.
  filterLinksByRole();
  buildReportsGroup();
  setupNavGroups();
  addIcons();
})();
