// Clerk auth: verify the session token the frontend sends as a Bearer header,
// and look up the user's profile (email/name) for first-time account creation.
//
// The frontend (ClerkJS) calls `clerk.session.getToken()` and sends it as
// `Authorization: Bearer <token>` to the dashboard's own endpoints (/api/me etc.).
// The CLI-facing proxy (/api/chat/completions) is NOT Clerk-authed — it uses the
// issued chk_ API key instead.

import { verifyToken } from '@clerk/backend';
import { CLERK_SECRET_KEY } from './config.js';
import { bearerToken } from './http.js';
import { fetchWithTimeout } from './fetch-timeout.js';

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string | null>}
 */
export async function getClerkUserId(req) {
  if (!CLERK_SECRET_KEY) return null;
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const claims = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
    return claims && claims.sub ? claims.sub : null;
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
      headers: { authorization: `Bearer ${CLERK_SECRET_KEY}` }
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
