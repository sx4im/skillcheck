import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getClerkUserId } from '../_lib/clerk.js';
import { getUser } from '../_lib/users.js';
import { billingEnabled, publicAppUrl } from '../_lib/config.js';
import { createCheckoutSession } from '../_lib/stripe.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!billingEnabled) return sendJson(res, 400, { error: { message: 'Billing is not configured.' } });

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });
  try {
    const user = await getUser(userId);
    if (!user) return sendJson(res, 404, { error: { message: 'Account not found' } });
    if (user.plan === 'pro') return sendJson(res, 200, { alreadyPro: true });
    const checkout = await createCheckoutSession({
      uid: user.uid,
      email: user.email,
      successUrl: `${publicAppUrl}/app.html?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${publicAppUrl}/app.html?upgrade=cancelled`
    });
    if (typeof checkout.url !== 'string') throw new Error('Checkout URL missing.');
    const url = new URL(checkout.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid checkout URL.');
    return sendJson(res, 200, { url: url.href });
  } catch {
    return sendJson(res, 502, { error: { message: 'Could not start Stripe checkout.' } });
  }
}
