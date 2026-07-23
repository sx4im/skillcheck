import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getClerkUserId, fetchClerkProfile } from '../_lib/clerk.js';
import { getUser, getOrCreateUser, rotateApiKey } from '../_lib/users.js';
import { maskApiKey } from '../_lib/keys.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  if (!(await getUser(userId))) {
    const profile = await fetchClerkProfile(userId);
    await getOrCreateUser({ userId, email: profile.email, name: profile.name });
  }

  const user = await rotateApiKey(userId);
  if (!user) return sendJson(res, 404, { error: { message: 'Account not found' } });
  sendJson(res, 200, { apiKey: user.apiKey, apiKeyMasked: maskApiKey(user.apiKey) });
}
