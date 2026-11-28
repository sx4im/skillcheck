// Fulfillment on return from Stripe Checkout. Verifies the session server-side
// (no webhook needed): if it is paid and belongs to the signed-in user, mark pro.

import { sendJson, methodNotAllowed, isObject } from '../_lib/http.js';
import { getClerkUserId } from '../_lib/clerk.js';
import { setPlan } from '../_lib/users.js';
import { billingEnabled, STRIPE_MODE, STRIPE_PRICE_ID, publicAppUrl } from '../_lib/config.js';
import { getCheckoutSession } from '../_lib/stripe.js';

/** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
export default async function handler(req, res) {
  // POST-only: this handler mutates the plan, and the frontend calls it with
  // POST (assets/app.js). A state-changing GET invites prefetchers/scanners.
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!billingEnabled) return sendJson(res, 400, { error: { message: 'Billing is not configured.' } });

  const userId = await getClerkUserId(req);
  if (!userId) return sendJson(res, 401, { error: { message: 'Not signed in' } });

  try {
    const url = new URL(req.url ?? '/', publicAppUrl);
    const [sessionId, ...duplicates] = url.searchParams.getAll('session_id');
    if (!sessionId || duplicates.length || !/^cs_(?:test|live)_[a-zA-Z0-9]{1,200}$/.test(sessionId)) {
      return sendJson(res, 400, { error: { message: 'Invalid session_id.' } });
    }
    const checkout = await getCheckoutSession(sessionId);
    const items = isObject(checkout.line_items) ? checkout.line_items.data : undefined;
    const item = Array.isArray(items) && items.length === 1 ? items[0] : undefined;
    const purchasedPlan = isObject(item?.price) && item.price.id === STRIPE_PRICE_ID && item.quantity === 1;
    if (checkout.id === sessionId && checkout.mode === STRIPE_MODE && checkout.status === 'complete' &&
      checkout.payment_status === 'paid' && checkout.client_reference_id === userId && purchasedPlan) {
      if (!await setPlan(userId, 'pro')) return sendJson(res, 404, { error: { message: 'Account not found' } });
      return sendJson(res, 200, { plan: 'pro' });
    }
    return sendJson(res, 200, { plan: 'free', paid: false });
  } catch {
    return sendJson(res, 502, { error: { message: 'Could not verify Stripe payment.' } });
  }
}
