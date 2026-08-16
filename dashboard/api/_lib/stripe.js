// Minimal Stripe REST client (no SDK dependency). Used for the upgrade flow:
// create a Checkout Session, then verify it server-side on return.

import { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_MODE } from './config.js';
import { fetchWithTimeout } from './fetch-timeout.js';

/**
 * @param {Record<string, string | number | undefined>} params
 * @returns {string}
 */
function formEncode(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  return search.toString();
}

/**
 * @param {string} path
 * @param {string} method
 * @param {Record<string, string | number | undefined>} [params]
 * @returns {Promise<Record<string, unknown>>}
 */
async function stripe(path, method, params) {
  const response = await fetchWithTimeout(
    `https://api.stripe.com/v1/${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: params ? formEncode(params) : undefined
    },
    15000
  );
  // Check before parsing: a Stripe outage returns HTML, and .json() on that
  // would raise an opaque SyntaxError instead of a status we can report.
  if (!response.ok) {
    throw new Error(`Stripe HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data && data.error) throw new Error(data.error.message || 'Stripe error');
  return data;
}

/**
 * @param {{ uid: string, email?: string, successUrl: string, cancelUrl: string }} params
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createCheckoutSession({ uid, email, successUrl, cancelUrl }) {
  return stripe('checkout/sessions', 'POST', {
    mode: STRIPE_MODE,
    'line_items[0][price]': STRIPE_PRICE_ID,
    'line_items[0][quantity]': 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: uid,
    ...(email ? { customer_email: email } : {})
  });
}

/**
 * @param {string} id
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getCheckoutSession(id) {
  return stripe(`checkout/sessions/${encodeURIComponent(id)}`, 'GET');
}
