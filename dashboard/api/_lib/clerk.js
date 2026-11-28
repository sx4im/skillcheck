// Clerk auth: verify the session token the frontend sends as a Bearer header,
// and look up the user's profile (email/name) for first-time account creation.
//
// The frontend (ClerkJS) calls `clerk.session.getToken()` and sends it as
// `Authorization: Bearer <token>` to the dashboard's own endpoints (/api/me etc.).
// The CLI-facing proxy (/api/chat/completions) is NOT Clerk-authed — it uses the
// issued chk_ API key instead.

import { decodeJwt, verifyJwt } from '@clerk/backend/jwt';
import { CLERK_SECRET_KEY, publicAppUrl } from './config.js';
import { bearerToken } from './http.js';
import { fetchWithTimeout } from './fetch-timeout.js';

const trustedOrigins = new Set([new URL(publicAppUrl).origin]);
for (const hostname of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
  if (hostname) trustedOrigins.add(`https://${hostname}`);
}
if (trustedOrigins.has('https://skillcheck.page') || trustedOrigins.has('https://www.skillcheck.page')) {
  trustedOrigins.add('https://skillcheck.page');
  trustedOrigins.add('https://www.skillcheck.page');
}

/** @type {Map<string, JsonWebKey>} */
let signingKeys = new Map();
let refreshAt = 0;
/** @type {Promise<Map<string, JsonWebKey>> | undefined} */
let refresh;

async function loadSigningKeys() {
  const response = await fetchWithTimeout('https://api.clerk.com/v1/jwks', {
    headers: { authorization: `Bearer ${CLERK_SECRET_KEY}` },
    redirect: 'error'
  });
  if (!response.ok) throw new Error('Could not load Clerk signing keys.');
  const data = await response.json();
  if (!Array.isArray(data?.keys)) throw new Error('Invalid Clerk signing key response.');
  signingKeys = new Map();
  for (const key of data.keys) {
    if (key?.kty === 'RSA' && typeof key.kid === 'string' && typeof key.n === 'string' && typeof key.e === 'string') {
      signingKeys.set(key.kid, key);
    }
  }
  refreshAt = Date.now() + 5 * 60 * 1000;
  return signingKeys;
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string | null>}
 */
export async function getClerkUserId(req) {
  if (!CLERK_SECRET_KEY) return null;
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const { header } = decodeJwt(token);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
    // A fresh cache is authoritative so unknown key IDs cannot force network calls.
    const keys = Date.now() < refreshAt ? signingKeys : await (refresh ??= loadSigningKeys().finally(() => { refresh = undefined; }));
    const key = keys.get(header.kid);
    if (!key) return null;
    const claims = await verifyJwt(token, { key, authorizedParties: [...trustedOrigins] });
    return claims.sid && typeof claims.sub === 'string' && trustedOrigins.has(claims.azp ?? '') ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} userId
 * @returns {Promise<{ email?: string, name?: string }>}
 */
export async function fetchClerkProfile(userId) {
  if (!CLERK_SECRET_KEY) return {};
  try {
    const response = await fetchWithTimeout(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${CLERK_SECRET_KEY}` },
      redirect: 'error'
    });
    if (!response.ok) return {};
    const user = /** @type {{ email_addresses?: Array<{ id: string, email_address: string }>, primary_email_address_id?: string, first_name?: string, last_name?: string, username?: string }} */ (
      await response.json()
    );
    const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
    const primary = emails.find((entry) => entry.id === user.primary_email_address_id) || emails[0];
    const email = (primary && primary.email_address) || '';
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
    return { email, name };
  } catch {
    return {};
  }
}
