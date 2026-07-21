const AUTH_KEY = 'pos_auth';
const THEME_KEY = 'pos_theme';
const DEFAULT_THEME = 'newlight';
const ROLE_HOME = {
  admin: '/dashboard.html',
  manager: '/dashboard.html',
  staff: '/pos/ui/1/register'
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || DEFAULT_THEME);
}

function getTheme() {
  return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
}

function setTheme(theme) {
  const value = theme || DEFAULT_THEME;
  localStorage.setItem(THEME_KEY, value);
  applyTheme(value);
}

applyTheme(getTheme());

function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function logout() {
  const auth = getAuth();
  const clearClientCache = () => {
    sessionStorage.clear();
    if ('caches' in window) {
      caches.keys()
        .then(keys => Promise.all(keys.map(key => caches.delete(key))))
        .catch(() => {});
    }
  };
  const doLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        clearAuth();
        document.cookie.split(';').forEach((cookie) => {
          const name = cookie.split('=')[0].trim();
          if (!name) return;
          document.cookie = `${name}=; Max-Age=0; path=/`;
        });
        clearClientCache();
        window.location.replace('/login.html');
      });
  };

  if (auth?.role === 'staff') {
    fetch('/api/clock/status')
      .then(res => res.json())
      .then(shift => {
        if (!shift) {
          doLogout();
          return;
        }
        fetch('/api/clock/clock-out', { method: 'POST' })
          .finally(() => doLogout());
      })
      .catch(() => doLogout());
    return;
  }

  doLogout();
}

function authHeaders() {
  const auth = getAuth();
  return auth?.id ? { 'x-employee-id': auth.id } : {};
}

function requireAuth() {
  const auth = getAuth();
  if (!auth) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login.html?next=${next}`;
    return null;
  }
  return auth;
}

function requireRole(roles) {
  const auth = requireAuth();
  if (!auth) return null;

  if (!roles.includes(auth.role)) {
    clearAuth();
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login.html?next=${next}&denied=1`;
    return null;
  }
  return auth;
}

function enforceAuthNavigation() {
  const auth = getAuth();
  const path = window.location.pathname;
  const isLogin = path.endsWith('/login.html');
  const isLogout = path.endsWith('/logout.html');

  if (!auth && !isLogin && !isLogout) {
    window.location.replace('/login.html');
    return;
  }

  if (auth && isLogin) {
    window.location.replace(ROLE_HOME[auth.role] || '/dashboard.html');
  }
}

function installAuthGuards() {
  enforceAuthNavigation();
  window.addEventListener('pageshow', () => {
    enforceAuthNavigation();
  });
  window.addEventListener('popstate', () => {
    enforceAuthNavigation();
  });
}

installAuthGuards();
