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
    home.href = auth.role === 'staff' ? '/pos.html' : '/dashboard.html';
    home.dataset.home = '1';
    home.textContent = 'Home';
    const firstLink = sidebar.querySelector('a[href]');
    if (firstLink && firstLink.parentNode) {
      firstLink.parentNode.insertBefore(home, firstLink);
    } else {
      sidebar.appendChild(home);
    }
  }

  function addNewPosLink() {
    if (sidebar.querySelector('a[href="/pos/ui/1/register"]')) return;
    const posLink = sidebar.querySelector('a[href="/pos.html"]');
    if (!posLink || !posLink.parentNode) return;
    const link = document.createElement('a');
    link.href = '/pos/ui/1/register';
    link.textContent = 'New POS';
    posLink.parentNode.insertBefore(link, posLink.nextSibling);
  }

  function filterLinksByRole() {
    const auth = getAuth();
    if (!auth || !auth.role) return;

    if (auth.role === 'staff') {
    const allowed = new Set(['/pos.html', '/pos/ui/1/register', '/clock.html', '/logout.html']);
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
      const hasActive = Array.from(children).some(link => link.getAttribute('href') === currentPath);
      if (hasActive) {
        group.classList.add('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
      }
      if (!toggle) return;
      toggle.addEventListener('click', () => {
        group.classList.toggle('open');
        const isOpen = group.classList.contains('open');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    });
  }

  addHomeLink();
  addNewPosLink();

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
    '/pos.html': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
        <path d="M3 4h2l2.4 9.6a2 2 0 0 0 2 1.4h7.6a2 2 0 0 0 2-1.5l1.2-6.5H7.2" />
      </svg>
    `,
    '/pos/ui/1/register': `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 9h8M8 13h8M8 17h5" />
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

  // Default to open on desktop, collapsed on mobile.
  filterLinksByRole();
  buildReportsGroup();
  setupNavGroups();
  addIcons();
  if (!document.body.classList.contains('pos-page') && window.matchMedia('(min-width: 900px)').matches) {
    openSidebar();
  }
})();
