// Minimal Stripe REST client (no SDK dependency). Used for the upgrade flow:
// create a Checkout Session, then verify it server-side on return.

import { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_MODE } from './config.js';

function formEncode(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  return search.toString();
}

async function stripe(path, method, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params ? formEncode(params) : undefined
  });
  const data = await response.json();
  if (data && data.error) throw new Error(data.error.message || 'Stripe error');
  return data;
}

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

export async function getCheckoutSession(id) {
  return stripe(`checkout/sessions/${encodeURIComponent(id)}`, 'GET');
}
