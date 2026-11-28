// The CLI points SKILLCHECK_API_URL at <app>/api. Authenticate and meter its
// requests before forwarding the supported fields to NVIDIA.
import { sendJson, methodNotAllowed, proxyCors, bearerToken, readJsonBody } from '../_lib/http.js';
import { userForApiKey, consumeRun, rollbackRun } from '../_lib/users.js';
import { forwardChatCompletion, MAX_CHAT_BODY_BYTES, validateChat } from '../_lib/nvidia.js';
import { NVIDIA_API_KEY, publicAppUrl } from '../_lib/config.js';
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
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');
  if (!NVIDIA_API_KEY) return sendJson(res, 503, { error: { message: 'Model service is unavailable.' } });

  try {
    if (await limitIp(req, 'chat')) return rateLimitExceeded(res);
    const key = bearerToken(req);
    if (!key) {
      return sendJson(res, 401, {
        error: { message: 'Missing API key. Get one from the Skillcheck dashboard and set SKILLCHECK_TOKEN.', type: 'no_key' }
      });
    }
    const digest = apiKeyDigest(key);
    const user = digest ? await userForApiKey(digest) : null;
    if (!user) return sendJson(res, 401, { error: { message: 'Invalid Skillcheck API key.', type: 'invalid_key' } });
    if (await limitKey(digest, 'chat')) return rateLimitExceeded(res);

    const runId = req.headers['x-skillcheck-run'] ?? '';
    if (typeof runId !== 'string' || (runId && !/^[A-Za-z0-9_-]{1,64}$/.test(runId))) {
      return sendJson(res, 400, { error: { message: 'Invalid x-skillcheck-run header.' } });
    }
    const body = await readJsonBody(req, MAX_CHAT_BODY_BYTES);
    if ('status' in body) return sendJson(res, body.status, { error: { message: body.message } });
    const chat = validateChat(body.value);
    if ('message' in chat) return sendJson(res, 400, { error: { message: chat.message } });

    const meter = await consumeRun(user.uid, runId, user.plan);
    if (!meter.allowed) {
      if (meter.reason === 'run_call_limit') {
        return sendJson(res, 402, { error: { message: 'This run has reached its request limit.', type: 'run_call_limit' } });
      }
      const upgradeUrl = `${publicAppUrl}/app.html`;
      return sendJson(res, 402, {
        error: {
          message: `You've used all ${meter.limit} Skillcheck runs for this month. Manage your plan at ${upgradeUrl}`,
          type: 'quota_exceeded',
          upgrade_url: upgradeUrl
        }
      });
    }
    try {
      const result = await forwardChatCompletion(chat.payload);
      res.setHeader('x-skillcheck-runs-used', String(meter.used));
      return sendJson(res, 200, result);
    } catch {
      if (meter.counted) await rollbackRun(user.uid, runId, meter.month).catch(() => {});
      return sendJson(res, 502, { error: { message: 'Upstream model provider error.' } });
    }
  } catch {
    return sendJson(res, 503, { error: { message: 'Skillcheck service is unavailable.' } });
  }
}
