const express = require('express');
const db = require('../db');
const { verifyPin, verifyManagerPin, createSession, destroySession, SESSION_TTL_MS } = require('../lib/auth');

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
    const sec = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `🔒 Too many attempts. Please wait ${Math.ceil(sec/60)} minute(s).`, seconds: sec });
  }

  const user = db.prepare('SELECT id, name, role, pin_hash FROM users WHERE LOWER(name) = ? AND active = 1').get(key);
  if (!user || !verifyPin(pin, user.pin_hash)) {
    const count = (a?.count || 0) + 1;
    const left = MAX_ATTEMPTS - count;
    const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : null;
    attempts.set(key, { count, lockedUntil });
    if (lockedUntil) return res.status(429).json({ error: `🔒 Locked for ${LOCK_MS/60000} minutes after ${count} failed attempts.` });
    return res.status(401).json({ error: `❌ Wrong PIN. ${left} attempt(s) remaining.`, remaining: left });
  }

  attempts.delete(key);
  const publicUser = { id: user.id, name: user.name, role: user.role };
  const sid = createSession(publicUser);
  res.cookie('session', sid, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  res.json(publicUser);
});

// Manager-PIN check for discount/void authorization — the cashier doesn't
// know (or need) whose PIN it is, just that SOME active admin/manager
// approved it, so this checks against every manager/admin account rather than
// a specific name (unlike /pin, which logs in as one named user).
const MPIN_MAX_ATTEMPTS = 5;
const MPIN_LOCK_MS = 5 * 60 * 1000;
const mpinAttempts = new Map(); // requesting user id -> { count, lockedUntil }

router.post('/verify-manager-pin', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const pin = String(req.body?.pin ?? '').trim();
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const key = req.user.id;
  const a = mpinAttempts.get(key);
  if (a?.lockedUntil && a.lockedUntil > Date.now()) {
    const sec = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `🔒 Too many attempts. Please wait ${Math.ceil(sec/60)} minute(s).` });
  }

  const match = verifyManagerPin(db, pin);
  if (!match) {
    const count = (a?.count || 0) + 1;
    const left = MPIN_MAX_ATTEMPTS - count;
    const lockedUntil = count >= MPIN_MAX_ATTEMPTS ? Date.now() + MPIN_LOCK_MS : null;
    mpinAttempts.set(key, { count, lockedUntil });
    if (lockedUntil) return res.status(429).json({ error: `🔒 Locked for ${MPIN_LOCK_MS/60000} minutes after ${count} failed attempts.` });
    return res.status(401).json({ error: `❌ Wrong PIN. ${left} attempt(s) remaining.` });
  }

  mpinAttempts.delete(key);
  res.json({ ok: true, manager: { id: match.id, name: match.name } });
});

router.post('/logout', (req, res) => {
  const m = (req.headers.cookie || '').match(/session=([^;]+)/);
  if (m) destroySession(m[1]);
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json(req.user || null));


module.exports = router;