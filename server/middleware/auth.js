const { getSession } = require('../lib/auth');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const [name, ...rest] = part.trim().split('=');
    if (name) out[name] = decodeURIComponent(rest.join('='));
  });
  return out;
}

// Attach req.user from the session cookie (used on /api).
function attachSession(req, _res, next) {
  const s = getSession(parseCookies(req.headers.cookie).session);
  if (s) req.user = s.user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

// Guard HTML page navigation: redirect unauthenticated GETs to the login page.
function sessionGate(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  const isHtml = req.path === '/' || req.path.endsWith('.html');
  if (!isHtml) return next();
  const publicPaths = new Set(['/login.html', '/logout.html', '/auth.js']);
  if (publicPaths.has(req.path)) return next();

  const s = getSession(parseCookies(req.headers.cookie).session);
  if (!s) {
    const to = req.path === '/' ? '/login.html' : `/login.html?next=${encodeURIComponent(req.path)}`;
    return res.redirect(to);
  }
  if (req.path === '/') return res.redirect(s.user.role === 'staff' ? '/clock.html' : '/dashboard.html');
  next();
}

module.exports = { attachSession, requireAuth, requireRole, sessionGate };
