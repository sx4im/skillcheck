import { sendJson, methodNotAllowed } from './_lib/http.js';
import { getClerkUserId } from './_lib/clerk.js';
import { ensureUser, usageFor } from './_lib/users.js';
import { billingEnabled, FREE_RUNS } from './_lib/config.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  try {
    const user = await ensureUser(userId);
    const usage = await usageFor(user.uid, user.plan);
    return sendJson(res, 200, {
      email: user.email,
      name: user.name,
      plan: user.plan,
      apiKey: user.apiKey,
      apiKeyMasked: user.apiKeyMasked,
      runsUsed: usage.runsUsed,
      runsLimit: usage.runsLimit,
      freeRuns: FREE_RUNS,
      billingEnabled
    });
  } catch {
    return sendJson(res, 503, { error: { message: 'Skillcheck service is unavailable.' } });
  }
}
