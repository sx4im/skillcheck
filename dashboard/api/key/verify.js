// The CLI verifies a key during setup without consuming a metered run.
import { sendJson, methodNotAllowed, proxyCors, bearerToken, readJsonBody, isObject } from '../_lib/http.js';
import { userForApiKey, usageFor } from '../_lib/users.js';
import { apiKeyDigest } from '../_lib/keys.js';
import { limitIp, limitKey, rateLimitExceeded } from '../_lib/rate-limit.js';

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
export default async function handler(req, res) {
  proxyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res, 'POST, GET, OPTIONS');

  try {
    if (await limitIp(req, 'verify')) return rateLimitExceeded(res);
    const key = bearerToken(req);
    if (!key) return sendJson(res, 401, { valid: false, error: { message: 'Missing API key.', type: 'no_key' } });
    const digest = apiKeyDigest(key);
    const user = digest ? await userForApiKey(digest) : null;
    if (!user) {
      return sendJson(res, 401, { valid: false, error: { message: 'Invalid Skillcheck API key.', type: 'invalid_key' } });
    }
    if (await limitKey(digest, 'verify')) return rateLimitExceeded(res);

    const body = await readJsonBody(req, 1024);
    if ('status' in body) return sendJson(res, body.status, { valid: false, error: { message: body.message } });
    if (body.value !== undefined && (!isObject(body.value) || Object.keys(body.value).length > 0)) {
      return sendJson(res, 400, { valid: false, error: { message: 'Expected an empty JSON object.' } });
    }
    const usage = await usageFor(user.uid, user.plan);
    return sendJson(res, 200, {
      valid: true,
      plan: user.plan,
      email: user.email,
      runsUsed: usage.runsUsed,
      runsLimit: usage.runsLimit,
      apiKeyMasked: user.apiKeyMasked
    });
  } catch {
    return sendJson(res, 503, { valid: false, error: { message: 'Skillcheck service is unavailable.' } });
  }
}
