const express = require('express');
const db = require('../db');
const { verifyPin, createSession, destroySession, SESSION_TTL_MS } = require('../lib/auth');

const router = express.Router();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;
const attempts = new Map(); // name -> { count, lockedUntil }

router.post('/pin', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const pin = String(req.body?.pin ?? '').trim();
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });

  const key = name.toLowerCase();
  const a = attempts.get(key);
  if (a?.lockedUntil && a.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'User locked', attempts: a.count, remaining: 0 });
  }

  const user = db.prepare('SELECT id, name, role, pin_hash FROM users WHERE LOWER(name) = ? AND active = 1').get(key);
  if (!user || !verifyPin(pin, user.pin_hash)) {
    const count = (a?.count || 0) + 1;
    const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : null;
    attempts.set(key, { count, lockedUntil });
    if (lockedUntil) return res.status(429).json({ error: 'User locked', attempts: count, remaining: 0 });
    return res.status(401).json({ error: 'Invalid credentials', attempts: count, remaining: Math.max(0, MAX_ATTEMPTS - count) });
  }

  attempts.delete(key);
  const publicUser = { id: user.id, name: user.name, role: user.role };
  const sid = createSession(publicUser);
  res.cookie('session', sid, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  res.json(publicUser);
});

router.post('/logout', (req, res) => {
  const m = (req.headers.cookie || '').match(/session=([^;]+)/);
  if (m) destroySession(m[1]);
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json(req.user || null));

module.exports = router;
