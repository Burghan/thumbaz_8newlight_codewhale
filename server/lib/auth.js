// PIN hashing (scrypt, no external deps) + in-memory session store.
const crypto = require('crypto');

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // NOTE: in-memory — cleared on restart. Move to a table/JWT before scaling.

function createSession(user) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { user, expires: Date.now() + SESSION_TTL_MS });
  return id;
}

function getSession(id) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(id); return null; }
  return s;
}

function destroySession(id) { if (id) sessions.delete(id); }

module.exports = { hashPin, verifyPin, createSession, getSession, destroySession, SESSION_TTL_MS };
