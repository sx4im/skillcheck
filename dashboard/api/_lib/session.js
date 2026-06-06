// Stateless signed-cookie session. The cookie value is `<payload>.<hmac>` where
// payload is base64url(JSON) and hmac is HMAC-SHA256(payload, AUTH_SECRET). No
// server-side session store is needed; tampering invalidates the signature.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { AUTH_SECRET } from './config.js';
import { parseCookies, setCookie, clearCookie } from './http.js';

const COOKIE = 'sc_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  // Falls back to a dev secret so local runs work; production MUST set AUTH_SECRET.
  return AUTH_SECRET || 'skillcheck-dev-auth-secret-change-me';
}

function sign(payloadB64) {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

export function createSessionToken(data) {
  const payload = Buffer.from(JSON.stringify({ ...data, iat: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function getSession(req) {
  const token = parseCookies(req)[COOKIE];
  return verifySessionToken(token);
}

export function setSession(res, data) {
  setCookie(res, COOKIE, createSessionToken(data), { maxAge: MAX_AGE, httpOnly: true, sameSite: 'Lax', secure: true });
}

export function clearSession(res) {
  clearCookie(res, COOKIE);
}
