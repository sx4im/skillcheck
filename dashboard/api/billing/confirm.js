// Fulfillment on return from Stripe Checkout. Verifies the session server-side
// (no webhook needed): if it is paid and belongs to the signed-in user, mark pro.

import { sendJson, methodNotAllowed } from '../_lib/http.js';
import { getSession } from '../_lib/session.js';
import { setPlan } from '../_lib/users.js';
import { billingEnabled, appUrl } from '../_lib/config.js';
import { getCheckoutSession } from '../_lib/stripe.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res, 'POST, GET');
  if (!billingEnabled) return sendJson(res, 400, { error: { message: 'Billing is not configured.' } });

  const session = getSession(req);
  if (!session || !session.uid) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  const url = new URL(req.url, appUrl(req));
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return sendJson(res, 400, { error: { message: 'Missing session_id' } });

  try {
    const checkout = await getCheckoutSession(sessionId);
    const paid = checkout.payment_status === 'paid' || checkout.status === 'complete';
    if (paid && checkout.client_reference_id === session.uid) {
      await setPlan(session.uid, 'pro');
      return sendJson(res, 200, { plan: 'pro' });
    }
    sendJson(res, 200, { plan: 'free', paid: false });
  } catch (error) {
    sendJson(res, 502, { error: { message: String((error && error.message) || error) } });
  }
}
