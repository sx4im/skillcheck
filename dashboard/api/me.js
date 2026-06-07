import { sendJson, methodNotAllowed } from './_lib/http.js';
import { getClerkUserId, fetchClerkProfile } from './_lib/clerk.js';
import { getUser, getOrCreateUser, getRunsUsed, runLimitFor } from './_lib/users.js';
import { billingEnabled, FREE_RUNS } from './_lib/config.js';
import { maskApiKey } from './_lib/keys.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  // First request after sign-in creates the account and issues the API key.
  let user = await getUser(userId);
  if (!user) {
    const profile = await fetchClerkProfile(userId);
    user = await getOrCreateUser({ userId, email: profile.email, name: profile.name });
  }

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
