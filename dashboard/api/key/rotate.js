import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getSession } from '../_lib/session.js';
import { rotateApiKey } from '../_lib/users.js';
import { maskApiKey } from '../_lib/keys.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  const session = getSession(req);
  if (!session || !session.uid) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  const user = await rotateApiKey(session.uid);
  if (!user) return sendJson(res, 404, { error: { message: 'Account not found' } });
  sendJson(res, 200, { apiKey: user.apiKey, apiKeyMasked: maskApiKey(user.apiKey) });
}
