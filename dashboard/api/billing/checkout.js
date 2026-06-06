import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getClerkUserId } from '../_lib/clerk.js';
import { getUser } from '../_lib/users.js';
import { billingEnabled, appUrl } from '../_lib/config.js';
import { createCheckoutSession } from '../_lib/stripe.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!billingEnabled) return sendJson(res, 400, { error: { message: 'Billing is not configured.' } });

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });
  const user = await getUser(userId);
  if (!user) return sendJson(res, 404, { error: { message: 'Account not found' } });
  if (user.plan === 'pro') return sendJson(res, 200, { alreadyPro: true });

  const base = appUrl(req);
  try {
    const checkout = await createCheckoutSession({
      uid: user.uid,
      email: user.email,
      successUrl: `${base}/app.html?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/app.html?upgrade=cancelled`
    });
    sendJson(res, 200, { url: checkout.url });
  } catch (error) {
    sendJson(res, 502, { error: { message: String((error && error.message) || error) } });
  }
}
