import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getClerkUserId } from '../_lib/clerk.js';
import { ensureUser, rotateApiKey } from '../_lib/users.js';
import { maskApiKey } from '../_lib/keys.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  await ensureUser(userId);

  const user = await rotateApiKey(userId);
  if (!user) return sendJson(res, 404, { error: { message: 'Account not found' } });
  sendJson(res, 200, { apiKey: user.apiKey, apiKeyMasked: maskApiKey(user.apiKey) });
}
