// Authenticate a Skillcheck API key WITHOUT consuming a run. The CLI calls this
// during `skillcheck setup` to confirm a pasted key is valid before saving it,
// and to show the user their plan + remaining runs. Key-based (Bearer), NOT
// Clerk — same auth model as the proxy, so it works from the CLI.

import { sendJson, methodNotAllowed, proxyCors, bearerToken } from '../_lib/http.js';
import { uidForApiKey, usageFor, getUser } from '../_lib/users.js';
import { maskApiKey } from '../_lib/keys.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  proxyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res, 'POST, GET, OPTIONS');

  const key = bearerToken(req);
  if (!key) {
    return sendJson(res, 401, { valid: false, error: { message: 'Missing API key.', type: 'no_key' } });
  }
  const uid = await uidForApiKey(key);
  if (!uid) {
    return sendJson(res, 401, { valid: false, error: { message: 'Invalid Skillcheck API key.', type: 'invalid_key' } });
  }
  const user = await getUser(uid);
  if (!user) {
    return sendJson(res, 401, { valid: false, error: { message: 'Account not found for this key.', type: 'invalid_key' } });
  }

  const usage = await usageFor(uid, user.plan);
  sendJson(res, 200, {
    valid: true,
    plan: user.plan,
    email: user.email,
    runsUsed: usage.runsUsed,
    runsLimit: usage.runsLimit,
    apiKeyMasked: maskApiKey(key)
  });
}
