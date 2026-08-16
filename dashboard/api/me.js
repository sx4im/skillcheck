import { sendJson, methodNotAllowed } from './_lib/http.js';
import { getClerkUserId } from './_lib/clerk.js';
import { ensureUser, usageFor } from './_lib/users.js';
import { billingEnabled, FREE_RUNS } from './_lib/config.js';
import { maskApiKey } from './_lib/keys.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  // First request after sign-in creates the account and issues the API key.
  const user = await ensureUser(userId);

  const usage = await usageFor(user.uid, user.plan);
  sendJson(res, 200, {
    email: user.email,
    name: user.name,
    plan: user.plan,
    apiKey: user.apiKey,
    apiKeyMasked: maskApiKey(user.apiKey),
    runsUsed: usage.runsUsed,
    runsLimit: usage.runsLimit,
    freeRuns: FREE_RUNS,
    billingEnabled
  });
}
