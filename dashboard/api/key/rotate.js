import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getClerkUserId } from '../_lib/clerk.js';
import { ensureUser, rotateApiKey } from '../_lib/users.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  try {
    const account = await ensureUser(userId);
    // If this call created the account, return its first key without rotating it.
    const issued = account.apiKey ? account : await rotateApiKey(userId);
    if (!issued) return sendJson(res, 409, { error: { message: 'Account changed. Try rotating the key again.' } });
    return sendJson(res, 200, { apiKey: issued.apiKey, apiKeyMasked: issued.apiKeyMasked });
  } catch {
    return sendJson(res, 503, { error: { message: 'Skillcheck service is unavailable.' } });
  }
}
