// The metered proxy. The CLI points SKILLCHECK_API_URL at `<app>/api`, so the
// OpenAI SDK posts here. We authenticate the Skillcheck key, meter the run, then
// forward to NVIDIA with the server-side key and return the response unchanged.

import { sendJson, methodNotAllowed, proxyCors, bearerToken, readJsonBody } from '../_lib/http.js';
import { uidForApiKey, getUser, consumeRun } from '../_lib/users.js';
import { forwardChatCompletion } from '../_lib/nvidia.js';
import { NVIDIA_API_KEY, appUrl } from '../_lib/config.js';

export default async function handler(req, res) {
  proxyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');
  if (!NVIDIA_API_KEY) return sendJson(res, 500, { error: { message: 'Server is missing NVIDIA_API_KEY.' } });

  const key = bearerToken(req);
  if (!key) {
    return sendJson(res, 401, {
      error: { message: 'Missing API key. Get one from the Skillcheck dashboard and set SKILLCHECK_TOKEN.', type: 'no_key' }
    });
  }
  const uid = await uidForApiKey(key);
  if (!uid) return sendJson(res, 401, { error: { message: 'Invalid Skillcheck API key.', type: 'invalid_key' } });
  const user = await getUser(uid);
  if (!user) return sendJson(res, 401, { error: { message: 'Account not found for this key.', type: 'invalid_key' } });

  const runId = String(req.headers['x-skillcheck-run'] || '').trim();
  const meter = await consumeRun(uid, runId, user.plan);
  if (!meter.allowed) {
    return sendJson(res, 402, {
      error: {
        message: `You've used all ${meter.limit} free Skillcheck runs. Upgrade to keep going at ${appUrl(req)}/app.html`,
        type: 'quota_exceeded',
        upgrade_url: `${appUrl(req)}/app.html`
      }
    });
  }

  const body = await readJsonBody(req);
  try {
    const result = await forwardChatCompletion(body);
    res.statusCode = result.status;
    res.setHeader('content-type', result.contentType);
    res.setHeader('x-skillcheck-runs-used', String(meter.used));
    res.end(result.text);
  } catch (error) {
    sendJson(res, 502, { error: { message: 'Upstream model provider error.', detail: String((error && error.message) || error) } });
  }
}
