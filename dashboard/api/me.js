import { sendJson, methodNotAllowed } from './_lib/http.js';
import { getSession } from './_lib/session.js';
import { getUser, getRunsUsed, runLimitFor } from './_lib/users.js';
import { billingEnabled, FREE_RUNS } from './_lib/config.js';
import { maskApiKey } from './_lib/keys.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  const session = getSession(req);
  if (!session || !session.uid) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  const user = await getUser(session.uid);
  if (!user) return sendJson(res, 401, { error: { message: 'Account not found' } });

  const runsUsed = await getRunsUsed(user.uid);
  const limit = runLimitFor(user.plan);
  sendJson(res, 200, {
    email: user.email,
    name: user.name,
    plan: user.plan,
    apiKey: user.apiKey,
    apiKeyMasked: maskApiKey(user.apiKey),
    runsUsed,
    runsLimit: Number.isFinite(limit) ? limit : null,
    freeRuns: FREE_RUNS,
    billingEnabled
  });
}
